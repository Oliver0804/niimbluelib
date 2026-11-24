import {
  AutoShutdownTime,
  BatteryChargeLevel,
  ConnectResult,
  HeartbeatType,
  LabelType,
  PrinterInfoType,
  ResponseCommandId,
  SoundSettingsItemType,
} from ".";
import { NiimbotAbstractClient } from "../client";
import { FirmwareProgressEvent, PacketReceivedEvent, PrintProgressEvent } from "../events";
import { PrintTaskName, printTasks } from "../print_tasks";
import { AbstractPrintTask, PrintOptions } from "../print_tasks/AbstractPrintTask";
import { Validators, Utils } from "../utils";
import { SequentialDataReader } from "./data_reader";
import { HeartbeatData, PrintError, PrinterStatusData, PrintStatus, RfidInfo, officialPrinterClass } from "./dto";
import { NiimbotCrc32Packet, NiimbotPacket } from "./packet";
import { PacketGenerator } from "./packet_generator";
import CRC32 from "crc-32";

/**
 * Packet sender and parser.
 *
 * @category Packets
 */
/**
 * Parse PrinterStatusData response (In_PrinterStatusData 0xB5, official getPrinterHardwareInfo).
 * @category Packets
 */
export const parsePrinterStatusData = (data: Uint8Array): PrinterStatusData => {
  let protocolVersion = 0;
  let supportColor = 0;

  let versionMajor: number | undefined;
  let versionMinor: number | undefined;
  let cacheRows: number | undefined;
  let blockRows: number | undefined;

  if (data.length >= 6) {
    cacheRows = (data[2] << 8) | data[3];
    blockRows = (data[4] << 8) | data[5];
  }

  if (data.length > 12) {
    supportColor = data[10];
    versionMajor = data[11];
    versionMinor = data[12];

    const n = data[11] * 100 + data[12];

    if (n >= 204 && n < 300) {
      protocolVersion = 3;
    } else if (n < 300 || n >= 302) {
      protocolVersion = n >= 302 ? 5 : 0;
    } else {
      protocolVersion = 4;
    }
  }

  return {
    supportColor,
    protocolVersion,
    versionMajor,
    versionMinor,
    cacheRows,
    blockRows,
    officialClass: officialPrinterClass(3, versionMajor, versionMinor),
  };
};

/**
 * Parse HeartbeatAdvanced2 response (HeartbeatType 4, official cPrinterV4/V5/V6).
 * @category Packets
 */
export const parseHeartbeatAdvanced2 = (data: Uint8Array): HeartbeatData => {
  const r = new SequentialDataReader(data);
  const info: HeartbeatData = {};

  // Field offsets follow the official SDK heartbeat parser (cPrinterV4/V5/V6, HeartbeatType 4):
  // [2] power · [3] not read by official SDK · [4] cap · [5] paper · [6] paperRfid · [7] ribbonRfid · [8] ribbon
  // · [9..10] wifiRssi (V5+) · [11] firmwareUpgradeStatus · [12] lightingErrorCode · [13] adapterVoltageStatus
  // · [14] cutterStatus · [15] wifiUpgradeStatus · [16] bluetoothUpgradeStatus · [18] numberOfFaultEventFrames (V6).
  // Longer responses are accepted (no EOF check) so newer firmware fields don't break the heartbeat.
  Validators.u8ArrayLengthAtLeast(data, 9);
  const d = data;
  r.skip(2);
  info.chargeLevel = r.readI8();
  /** Not read by the official SDK; kept for backward compatibility */
  info.temp = r.readI8();
  info.lidClosed = r.readI8() === 0;
  info.paperInserted = r.readI8() === 0;
  info.paperRfidSuccess = r.readI8() !== 0;
  info.ribbonRfidSuccess = r.readI8() !== 0;
  info.ribbonInserted = r.readI8() === 0;

  if (r.canRead(2)) {
    info.wifiRssi = r.readI16();
  }
  if (d.length > 12) {
    info.firmwareUpgradeStatus = d[11];
    info.lightingErrorCode = d[12];
  }
  if (d.length > 13) info.voltageState = d[13];
  if (d.length > 14) info.cutterStatus = d[14];
  if (d.length > 15) info.wifiUpgradeStatus = d[15];
  if (d.length > 16) info.bluetoothUpgradeStatus = d[16];
  if (d.length > 18) info.faultEventFrames = d[18];

  return info;
};

/**
 * Parse RFID info payload (In_RfidInfo 0x1B / In_RfidInfo2 0x1D).
 *
 * Field order follows the official SDK `rfiddatapro()` (libjcPrinterSdk, shared by cPrinterV3/V6):
 * UUID(8) · barcode(vstr) · batchNumber(vstr) · qestrictionNumber(u16) · usedNumber(u16) · paperType(u8)
 * · ratedCapacity(u16, opt) · UUID2(8, opt) · classCode(u32, opt).
 * All integers are big endian and unsigned. Trailing bytes are ignored so newer firmware fields don't break parsing.
 *
 * @category Packets
 */
export const parseRfidInfo = (data: Uint8Array): RfidInfo => {
  const info: RfidInfo = {
    tagPresent: false,
    uuid: "",
    barCode: "",
    serialNumber: "",
    allPaper: -1,
    usedPaper: -1,
    consumablesType: LabelType.Invalid,
  };

  if (data.length <= 1) {
    return info;
  }

  const r = new SequentialDataReader(data);
  info.tagPresent = true;
  info.uuid = Utils.bufToHex(r.readBytes(8), "");
  info.barCode = r.readVString();
  info.serialNumber = r.readVString();
  info.allPaper = r.readU16();
  info.usedPaper = r.readU16();
  info.consumablesType = r.readI8() as LabelType;

  if (r.canRead(2)) {
    info.capacity = r.readU16();
  }
  if (r.canRead(8)) {
    info.uuid2 = Utils.bufToHex(r.readBytes(8), "");
  }
  if (r.canRead(4)) {
    info.classCode = r.readU32();
  }

  return info;
};

export class Abstraction {
  private readonly DEFAULT_PACKET_TIMEOUT: number = 1_000;
  private client: NiimbotAbstractClient;
  private packetTimeout: number = this.DEFAULT_PACKET_TIMEOUT;
  private statusPollTimer: NodeJS.Timeout | undefined;
  private statusTimeoutTimer: NodeJS.Timeout | undefined;

  constructor(client: NiimbotAbstractClient) {
    this.client = client;
  }

  public getClient(): NiimbotAbstractClient {
    return this.client;
  }

  public getPacketTimeout(): number {
    return this.packetTimeout;
  }

  public setPacketTimeout(value: number) {
    this.packetTimeout = value;
  }

  public setDefaultPacketTimeout() {
    this.packetTimeout = this.DEFAULT_PACKET_TIMEOUT;
  }

  /** Send packet and wait for response */
  public async send(packet: NiimbotPacket, forceTimeout?: number): Promise<NiimbotPacket> {
    return this.client.sendPacketWaitResponse(packet, forceTimeout ?? this.packetTimeout);
  }

  /** Send packet, wait for response, repeat if failed */
  public async sendRepeatUntilSuccess(
    packet: NiimbotPacket,
    attempts: number,
    forceTimeout?: number,
  ): Promise<NiimbotPacket> {
    let lastError: Error = new Error("Unknown error");

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.client.sendPacketWaitResponse(packet, forceTimeout ?? this.packetTimeout);
      } catch (e) {
        console.warn(`Attempt ${attempt + 1} failed:`, e);
        lastError = e as Error;
      }
    }

    throw lastError;
  }

  public async sendAll(packets: NiimbotPacket[], forceTimeout?: number): Promise<void> {
    for (const p of packets) {
      await this.send(p, forceTimeout);
    }
  }

  public async getPrintStatus(tries: number = 1): Promise<PrintStatus> {
    const packet = await this.sendRepeatUntilSuccess(PacketGenerator.printStatus(), tries ?? 1);

    Validators.u8ArrayLengthAtLeast(packet.data, 4); // can be 8, 10, but ignore it for now

    const r = new SequentialDataReader(packet.data);
    const page = r.readU16(); // official: u16 BE
    const pagePrintProgress = r.readI8();
    const pageFeedProgress = r.readI8();

    // Note: treating data[6] as an error code for 10-byte responses is a niimbluelib heuristic;
    // the official SDK parser (In_PrintStatus 0xB3) has no such rule.
    if (packet.dataLength === 10) {
      r.skip(2);
      const error = r.readI8();

      if (error !== 0) {
        throw new PrintError(`Print error (${ResponseCommandId[packet.command]} packet flag)`, error);
      }
    }

    return { page, pagePrintProgress, pageFeedProgress };
  }

  public async connectResult(): Promise<ConnectResult> {
    const packet = await this.send(PacketGenerator.connect());
    Validators.u8ArrayLengthAtLeast(packet.data, 1);
    return packet.data[0] as ConnectResult;
  }

  public async getPrinterStatusData(): Promise<PrinterStatusData> {
    const packet = await this.send(PacketGenerator.getPrinterStatusData());
    return parsePrinterStatusData(packet.data);
  }

  public async getPrinterModel(): Promise<number> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.PrinterModelId));
    Validators.u8ArrayLengthAtLeast(packet.data, 1);

    if (packet.data.length === 1) {
      return packet.data[0] << 8;
    }

    Validators.u8ArrayLengthEquals(packet.data, 2);
    return Utils.bytesToI16(packet.data);
  }

  private processRfidInfo(packet: NiimbotPacket): RfidInfo {
    return parseRfidInfo(packet.data);
  }

  /** Read paper nfc tag info */
  public async rfidInfo(): Promise<RfidInfo> {
    const packet = await this.send(PacketGenerator.rfidInfo());
    return this.processRfidInfo(packet);
  }

  /** Read ribbon nfc tag info */
  public async rfidInfo2(): Promise<RfidInfo> {
    const packet = await this.send(PacketGenerator.rfidInfo2());
    return this.processRfidInfo(packet);
  }

  private processHeartbeatAdvanced1(packet: NiimbotPacket): HeartbeatData {
    const len = packet.dataLength;
    const r = new SequentialDataReader(packet.data);
    const info: HeartbeatData = {};

    // originally expected packet length is bound to model id, but we make it more robust and simple
    if (len === 10) {
      // d110
      r.skip(8);
      info.lidClosed = r.readI8() === 0;
      info.chargeLevel = r.readI8();
    } else if (len === 13) {
      // b1
      r.skip(9);
      info.lidClosed = r.readI8() === 0;
      info.chargeLevel = r.readI8();
      info.paperInserted = r.readI8() === 0;
      info.paperRfidSuccess = r.readI8() !== 0;
    } else if (len === 19) {
      r.skip(15);
      info.lidClosed = r.readI8() === 0;
      info.chargeLevel = r.readI8();
      info.paperInserted = r.readI8() === 0;
      info.paperRfidSuccess = r.readI8() !== 0;
    } else if (len === 20) {
      r.skip(18);
      info.paperInserted = r.readI8() === 0;
      info.paperRfidSuccess = r.readI8() !== 0;
    } else {
      throw new Error("Invalid heartbeat length");
    }
    r.end();

    const printerInfo = this.client.getPrinterInfo();

    const invertedLidModels = [512, 514, 513, 2304, 1792, 3584, 5120, 2560, 3840, 4352, 272, 273, 274];

    if (printerInfo?.modelId !== undefined && invertedLidModels.includes(printerInfo.modelId)) {
      info.lidClosed = !info.lidClosed;
    }

    return info;
  }

  private processHeartbeatAdvanced2(packet: NiimbotPacket): Partial<HeartbeatData> {
    return parseHeartbeatAdvanced2(packet.data);
  }

  public async heartbeat(): Promise<HeartbeatData> {
    const printerInfo = this.client.getPrinterInfo();
    let heartbeatType = HeartbeatType.Advanced1;
    if (printerInfo.protocolVersion !== undefined && printerInfo.protocolVersion >= 3) {
      heartbeatType = HeartbeatType.Advanced2;
    }

    const packet = await this.send(PacketGenerator.heartbeat(heartbeatType), 500);

    if (packet.command === ResponseCommandId.In_HeartbeatAdvanced1) {
      return this.processHeartbeatAdvanced1(packet);
    }

    if (packet.command === ResponseCommandId.In_HeartbeatAdvanced2) {
      return this.processHeartbeatAdvanced2(packet);
    }

    throw new Error("Unsupported heartbeat response");
  }

  public async getBatteryChargeLevel(): Promise<BatteryChargeLevel> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.BatteryChargeLevel));
    Validators.u8ArrayLengthEquals(packet.data, 1);
    return packet.data[0] as BatteryChargeLevel;
  }

  public async getAutoShutDownTime(): Promise<AutoShutdownTime> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.AutoShutdownTime));
    Validators.u8ArrayLengthEquals(packet.data, 1);
    return packet.data[0] as AutoShutdownTime;
  }

  /** May be wrong, version format varies between models */
  public async getSoftwareVersion(): Promise<string> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.SoftWareVersion));
    Validators.u8ArrayLengthEquals(packet.data, 2);

    // todo: find how to determine format

    const v1 = packet.data[1] / 100 + packet.data[0];
    const v2 = (packet.data[0] * 256 + packet.data[1]) / 100.0;

    return `0x${Utils.bufToHex(packet.data, "")} (${v1.toFixed(2)} or ${v2.toFixed(2)})`;
  }

  /** May be wrong, version format varies between models */
  public async getHardwareVersion(): Promise<string> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.HardWareVersion));
    Validators.u8ArrayLengthEquals(packet.data, 2);

    // todo: find how to determine format

    const v1 = packet.data[1] / 100 + packet.data[0];
    const v2 = (packet.data[0] * 256 + packet.data[1]) / 100.0;

    return `0x${Utils.bufToHex(packet.data, "")} (${v1.toFixed(2)} or ${v2.toFixed(2)})`;
  }

  public async setAutoShutDownTime(time: AutoShutdownTime): Promise<void> {
    await this.send(PacketGenerator.setAutoShutDownTime(time));
  }

  public async getLabelType(): Promise<LabelType> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.LabelType));
    Validators.u8ArrayLengthEquals(packet.data, 1);
    return packet.data[0] as LabelType;
  }

  public async getPrinterSerialNumber(): Promise<string> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.SerialNumber));
    Validators.u8ArrayLengthAtLeast(packet.data, 1);

    if (packet.data.length < 4) {
      return "-1";
    }

    if (packet.data.length >= 8) {
      return Utils.u8ArrayToString(packet.data);
    }

    return Utils.bufToHex(packet.data.slice(0, 4), "").toUpperCase();
  }

  public async getPrinterBluetoothMacAddress(): Promise<string> {
    const packet = await this.send(PacketGenerator.getPrinterInfo(PrinterInfoType.BluetoothAddress));
    Validators.u8ArrayLengthAtLeast(packet.data, 1);
    return Utils.bufToHex(packet.data.reverse(), ":");
  }

  public async isSoundEnabled(soundType: SoundSettingsItemType): Promise<boolean> {
    const packet = await this.send(PacketGenerator.getSoundSettings(soundType));
    Validators.u8ArrayLengthEquals(packet.data, 3);
    const value = !!packet.data[2];
    return value;
  }

  public async setSoundEnabled(soundType: SoundSettingsItemType, value: boolean): Promise<void> {
    await this.send(PacketGenerator.setSoundSettings(soundType, value));
  }

  /** Clear settings */
  public async printerReset(): Promise<void> {
    await this.send(PacketGenerator.printerReset());
  }

  public async waitUntilPrintFinishedByPageIndex(pagesToPrint: number, timeoutMs: number = 5_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const listener = (evt: PacketReceivedEvent) => {
        if (evt.packet.command === ResponseCommandId.In_PrinterPageIndex) {
          Validators.u8ArrayLengthEquals(evt.packet.data, 2);
          const page = Utils.bytesToI16(evt.packet.data);

          this.client.emit("printprogress", new PrintProgressEvent(page, pagesToPrint, 100, 100));

          clearTimeout(this.statusTimeoutTimer);
          this.statusTimeoutTimer = setTimeout(() => {
            this.client.off("packetreceived", listener);
            reject(new Error("Timeout waiting print status"));
          }, timeoutMs ?? 5_000);

          if (page === pagesToPrint) {
            clearTimeout(this.statusTimeoutTimer);
            this.client.off("packetreceived", listener);
            resolve();
          }
        }
      };

      clearTimeout(this.statusTimeoutTimer);
      this.statusTimeoutTimer = setTimeout(() => {
        this.client.off("packetreceived", listener);
        reject(new Error("Timeout waiting print status"));
      }, timeoutMs);

      this.client.emit("printprogress", new PrintProgressEvent(1, pagesToPrint, 0, 0));
      this.client.on("packetreceived", listener);
    });
  }

  /**
   * Poll printer every {@link pollIntervalMs} and resolve when printer pages equals {@link pagesToPrint}, pagePrintProgress=100, pageFeedProgress=100.
   *
   * printprogress event is firing during this process.
   *
   * @param pagesToPrint Total pages to print.
   * @param pollIntervalMs Poll interval in milliseconds.
   */
  public async waitUntilPrintFinishedByStatusPoll(pagesToPrint: number, pollIntervalMs: number = 300): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.emit("printprogress", new PrintProgressEvent(1, pagesToPrint, 0, 0));

      this.statusPollTimer = setInterval(() => {
        this.getPrintStatus(2)
          .then((status: PrintStatus) => {
            this.client.emit(
              "printprogress",
              new PrintProgressEvent(status.page, pagesToPrint, status.pagePrintProgress, status.pageFeedProgress),
            );

            if (status.page === pagesToPrint) {
              clearInterval(this.statusPollTimer);
              resolve();
            }
          })
          .catch((e: unknown) => {
            clearInterval(this.statusPollTimer);
            reject(e as Error);
          });
      }, pollIntervalMs ?? 300);
    });
  }

  /**
   * Poll printer every {@link pollIntervalMs} and resolve when printer pages equals {@link pagesToPrint}.
   *
   * printprogress event is firing during this process.
   *
   * PrintEnd call is not needed after this functions is done running.
   *
   * @param pagesToPrint Total pages to print.
   * @param pollIntervalMs Poll interval in milliseconds.
   */
  public async waitUntilPrintFinishedByPrintEndPoll(pagesToPrint: number, pollIntervalMs: number = 500): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.emit("printprogress", new PrintProgressEvent(1, pagesToPrint, 0, 0));

      this.statusPollTimer = setInterval(() => {
        this.printEnd()
          .then((printEndDone: boolean) => {
            if (!printEndDone) {
              this.client.emit("printprogress", new PrintProgressEvent(1, pagesToPrint, 0, 0));
            } else {
              this.client.emit("printprogress", new PrintProgressEvent(pagesToPrint, pagesToPrint, 100, 100));
              clearInterval(this.statusPollTimer);
              resolve();
            }
          })
          .catch((e: unknown) => {
            clearInterval(this.statusPollTimer);
            reject(e as Error);
          });
      }, pollIntervalMs ?? 500);
    });
  }

  /** False returned when printEnd refused */
  public async printEnd(): Promise<boolean> {
    const response = await this.send(PacketGenerator.printEnd());
    Validators.u8ArrayLengthEquals(response.data, 1);
    return response.data[0] === 1;
  }

  /**
   * PrintEnd with the official SDK retry policy (jcSetPrintTerminal):
   * while the printer answers 0 (still busy), wait {@link intervalMs} and resend, up to {@link tries} times.
   */
  public async printEndWithRetry(tries: number = 30, intervalMs: number = 500): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      if (await this.printEnd()) return true;
      if (i < tries - 1) await Utils.sleep(intervalMs);
    }
    return false;
  }

  /**
   * When 1 or 2 sent to B1, it starts to throw out some, paper (~15cm)
   * @param value success
   */
  public async labelPositioningCalibration(value: number): Promise<boolean> {
    const response = await this.send(PacketGenerator.labelPositioningCalibration(value));
    Validators.u8ArrayLengthEquals(response.data, 1);
    return response.data[0] === 1;
  }

  public async firmwareUpgrade(data: Uint8Array, version: string): Promise<void> {
    const crc = CRC32.buf(data);
    await this.send(PacketGenerator.startFirmwareUpgrade(version));

    await this.client.waitForPacket([ResponseCommandId.In_RequestFirmwareCrc], true, 5_000);

    await this.send(PacketGenerator.sendFirmwareChecksum(crc));

    const chunkSize = 200;
    const totalChunks = Math.floor(data.byteLength / chunkSize);
    console.log("Chunks to send:", totalChunks);

    // Send chunks
    while (true) {
      const p = await this.client.waitForPacket(
        [ResponseCommandId.In_RequestFirmwareChunk, ResponseCommandId.In_FirmwareResult],
        true,
        5_000,
      );

      if (p.command === ResponseCommandId.In_FirmwareResult) {
        //fixme
        throw new Error("Unexpected firmware result");
      }

      if (!(p instanceof NiimbotCrc32Packet)) {
        throw new Error("Not a firmware packet");
      }

      if (p.chunkNumber * chunkSize >= data.length) {
        console.log("No more chunks");
        break;
      }

      const part = data.slice(p.chunkNumber * chunkSize, p.chunkNumber * chunkSize + chunkSize);

      await this.send(PacketGenerator.sendFirmwareChunk(p.chunkNumber, part));

      this.client.emit("firmwareprogress", new FirmwareProgressEvent(p.chunkNumber, totalChunks));
    }

    await this.send(PacketGenerator.firmwareNoMoreChunks());

    const uploadResult = await this.client.waitForPacket([ResponseCommandId.In_FirmwareCheckResult], true, 5_000);
    Validators.u8ArrayLengthEquals(uploadResult.data, 1);

    if (uploadResult.data[0] !== 1) {
      throw new Error("Firmware check error (maybe CRC does not match)");
    }

    await this.send(PacketGenerator.firmwareCommit());

    const firmwareResult = await this.client.waitForPacket([ResponseCommandId.In_FirmwareResult], true, 5_000);

    Validators.u8ArrayLengthEquals(firmwareResult.data, 1);

    if (firmwareResult.data[0] !== 1) {
      throw new Error("Firmware error");
    }
  }

  public newPrintTask(name: PrintTaskName, options?: Partial<PrintOptions>): AbstractPrintTask {
    return new printTasks[name](this, options);
  }
}
