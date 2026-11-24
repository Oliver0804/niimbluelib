/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * Alignment with the official NIIMBOT SDK (libjcPrinterSdk) response layouts.
 * Real fixtures: B1 Pro FW 2.07 / HW 2.01, transparent 50×80 roll (95 labels), captured 2026-11-24.
 */
import { test, describe } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  LabelType,
  NiimbotPacket,
  PacketParser,
  RequestCommandId,
  ResponseCommandId,
  officialPrinterClass,
  PageColorType,
} from "../packets";
import { OfficialV6PrintTask } from "../print_tasks";
import type { NiimbotProtocol } from "../packets/protocol";
import type { EncodedImage, ImageRow } from "../utils";

const B1_PRO_STATUS = "55 55 b5 10 30 30 0c 1c 00 96 00 00 00 0a 01 03 02 06 22 00 0d aa aa";
const B1_PRO_RFID =
  "55 55 1b 29 88 1d 25 01 3b 23 10 80 08 30 31 31 36 32 31 30 31 10 50 43 30 49 41 31 35 33 30 39 30 30 32 36 31 38 00 72 00 05 05 00 5f 22 aa aa";
const B1_PRO_HEARTBEAT = "55 55 d9 0d 1f 78 50 4b 00 00 01 00 00 00 00 00 00 a9 aa aa";

/** RFID payload: UUID(8) barcode batch total(u16) used(u16) type(u8) [ratedCapacity(u16)] [UUID2(8)] [classCode(u32)] */
const rfidPayload = (tail: number[]): number[] => [
  0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
  4, ...Array.from("1234", (c) => c.charCodeAt(0)),
  2, ...Array.from("B1", (c) => c.charCodeAt(0)),
  0x00, 0x72, 0x00, 0x05, LabelType.Transparent,
  ...tail,
];

describe("RFID (In_RfidInfo 0x1B)", () => {
  test("real B1 Pro roll: qestrictionNumber 114, ratedCapacity 95", () => {
    const i = PacketParser.parseRfidInfoResponse(NiimbotPacket.fromHex(B1_PRO_RFID));
    strictEqual(i.barCode, "01162101");
    strictEqual(i.serialNumber, "PC0IA15309002618");
    strictEqual(i.allPaper, 114);
    strictEqual(i.usedPaper, 5);
    strictEqual(i.consumablesType, LabelType.Transparent);
    strictEqual(i.capacity, 95);
    strictEqual(i.uuid2, undefined);
    strictEqual(i.classCode, undefined);
  });

  test("UUID2 + classCode (official rfiddatapro tail) are parsed", () => {
    const uuid2 = [0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10];
    const pkt = new NiimbotPacket(ResponseCommandId.In_RfidInfo, rfidPayload([0x00, 0x5f, ...uuid2, 0xfe, 0xff, 0xff, 0x01]));
    const i = PacketParser.parseRfidInfoResponse(pkt);
    strictEqual(i.capacity, 95);
    strictEqual(i.uuid2, "fedcba9876543210");
    strictEqual(i.classCode, 0xfeffff01);
  });

  test("trailing unknown bytes do not throw", () => {
    const pkt = new NiimbotPacket(ResponseCommandId.In_RfidInfo, rfidPayload([0x00, 0x5f, 1, 2, 3]));
    const i = PacketParser.parseRfidInfoResponse(pkt);
    strictEqual(i.capacity, 95);
    strictEqual(i.classCode, undefined);
  });
});

describe("HeartbeatAdvanced2 (0xD9)", () => {
  test("real B1 Pro 13-byte response", () => {
    const i = PacketParser.parseHeartbeatAdvanced2Response(NiimbotPacket.fromHex(B1_PRO_HEARTBEAT));
    strictEqual(i.batteryPercents, 0x50);
    strictEqual(i.paperInserted, true);
    strictEqual(i.paperRfidSuccess, true);
    strictEqual(i.firmwareUpgradeStatus, 0);
    strictEqual(i.lightingErrorCode, 0);
    strictEqual(i.cutterStatus, undefined);
  });

  test("V6 19-byte response is accepted; wifiRssi is signed", () => {
    const d = new Array(19).fill(0).map((_, i) => (i >= 11 ? i : 0));
    d[2] = 80;
    d[9] = 0xff;
    d[10] = 0xd8; // -40
    const i = PacketParser.parseHeartbeatAdvanced2Response(new NiimbotPacket(ResponseCommandId.In_HeartbeatAdvanced2, d));
    strictEqual(i.wifiRssi, -40);
    strictEqual(i.firmwareUpgradeStatus, 11);
    strictEqual(i.lightingErrorCode, 12);
    strictEqual(i.voltageState, 13);
    strictEqual(i.cutterStatus, 14);
    strictEqual(i.wifiUpgradeStatus, 15);
    strictEqual(i.bluetoothUpgradeStatus, 16);
    strictEqual(i.faultEventFrames, 18);
  });
});

describe("PrinterStatusData (0xB5) and official printer class", () => {
  test("real B1 Pro: version 3.02 → V6, 150 rows per block", () => {
    const s = PacketParser.parsePrinterStatusDataResponse(NiimbotPacket.fromHex(B1_PRO_STATUS));
    strictEqual(s.versionMajor, 3);
    strictEqual(s.versionMinor, 2);
    strictEqual(s.protocolVersion, 5);
    strictEqual(s.officialClass, "V6");
    strictEqual(s.blockRows, 150);
    strictEqual(s.cacheRows, 0x0c1c);
  });

  test("selection rules (connectBluetoothPrinter)", () => {
    deepStrictEqual(
      [
        officialPrinterClass(3, 3, 2),
        officialPrinterClass(3, 3, 1),
        officialPrinterClass(3, 4, 0),
        officialPrinterClass(3, 2, 4),
        officialPrinterClass(3, 2, 3),
        officialPrinterClass(3, 2, 2),
        officialPrinterClass(3),
        officialPrinterClass(1),
        officialPrinterClass(2),
      ],
      ["V6", "V5", "V5", "V4", "V3", "V3", "V3", "V4", "V4"],
    );
  });
});

describe("OfficialV6PrintTask", () => {
  test("45-byte SetPageSize, no PageStart, no 0x83, waits 0xD3 after each full block", async () => {
    const sent: NiimbotPacket[] = [];
    let acks = 0;
    const client = {
      getPrinterInfo: () => ({ blockRows: 150 }),
      getModelMetadata: () => ({ printheadPixels: 567 }),
      waitForPacket: () => {
        acks++;
        return Promise.resolve(undefined);
      },
      emit: () => true,
    };
    const protocol = {
      getClient: () => client,
      sendAll: async (ps: NiimbotPacket[]) => {
        sent.push(...ps);
      },
    } as unknown as NiimbotProtocol;

    const rowsData: ImageRow[] = Array.from({ length: 579 }, (_, r) => {
      const rowData = new Uint8Array(71);
      rowData[10] = 0b10101000; // 3 black pixels: would produce 0x83 by default
      return { dataType: "pixels", rowNumber: r, repeat: 1, rowDataBlack: rowData, blackPixelsCount: 3, redPixelsCount: 0 };
    });
    const image: EncodedImage = { pageColor: PageColorType.SingleColor, cols: 568, rows: 579, rowsData };

    await new OfficialV6PrintTask(protocol, { totalPages: 1 }).printPage(image, 1);

    const cmds = sent.map((p) => p.command);
    strictEqual(cmds[0], RequestCommandId.SetPageSize);
    strictEqual(sent[0].data.length, 45);
    ok(!cmds.includes(RequestCommandId.PageStart));
    ok(!cmds.includes(RequestCommandId.PrintBitmapRowIndexed));
    strictEqual(cmds[cmds.length - 1], RequestCommandId.PageEnd);
    strictEqual(acks, 3); // blocks 0-149, 150-299, 300-449 (+ last partial block acked after PageEnd)
  });
});
