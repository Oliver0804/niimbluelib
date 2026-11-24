import { AutoShutdownTime, BatteryChargeLevel, ConnectResult, LabelType, SoundSettingsItemType, SoundSettingsType } from "./payloads";

/**
 * @category Packets
 */
export class PrintError extends Error {
  public readonly reasonId: number;

  constructor(message: string, reasonId: number) {
    super(message);
    this.reasonId = reasonId;
  }
}

/**
 * Interface representing printer information.
 *
 * @category Client
 */
export interface PrinterInfo {
  connectResult?: ConnectResult;
  protocolVersion?: number;
  modelId?: number;
  serial?: string;
  mac?: string;
  charge?: BatteryChargeLevel;
  autoShutdownTime?: AutoShutdownTime;
  labelType?: LabelType;
  softwareVersion?: string;
  hardwareVersion?: string;
  /** Official SDK printer class (V3..V6), see {@link officialPrinterClass} */
  officialClass?: OfficialPrinterClass;
  /** Rows per data block (0xA5 data[4..5]); the printer answers 0xD3 after each block */
  blockRows?: number;
  /** Printer row cache (0xA5 data[2..3]) */
  cacheRows?: number;
}

/**
 * @category Packets
 */
export interface PrintStatus {
  /** 0 – n */
  page: number;
  /** 0 – 100 */
  pagePrintProgress: number;
  /** 0 – 100 */
  pageFeedProgress: number;
}

/**
 * @category Packets
 */
export interface RfidInfo {
  tagPresent: boolean;
  /** Official SDK key: `UUID` (8 bytes, hex) */
  uuid: string;
  /** Official SDK key: `barcode`. Used as `oneCode` for the NIIMBOT cloud label lookup */
  barCode: string;
  /** Official SDK key: `batchNumber` (batch number) */
  serialNumber: string;
  /** Official SDK key: `qestrictionNumber` (sic) — total labels on the roll. u16 BE, unsigned */
  allPaper: number;
  /** Official SDK key: `usedNumber`. u16 BE, unsigned */
  usedPaper: number;
  /** Official SDK key: `paperType` */
  consumablesType: LabelType;
  /** Official SDK key: `ratedCapacity`. u16 BE, unsigned, optional */
  capacity?: number;
  /** Official SDK key: `UUID2` (8 bytes, hex), optional */
  uuid2?: string;
  /** Official SDK key: `classCode`. u32 BE, unsigned, optional */
  classCode?: number;
}

/**
 * Available fields depend on model.
 *
 * @category Packets
 **/
export interface HeartbeatData {
  paperInserted?: boolean;
  paperRfidSuccess?: boolean;
  lidClosed?: boolean;
  chargeLevel?: BatteryChargeLevel;

  temp?: number;
  ribbonInserted?: boolean;
  ribbonRfidSuccess?: boolean;

  wifiRssi?: number;
  lightingErrorCode?: number;
  /** Official SDK key: `adapterVoltageStatus` (Advanced2 data[13]) */
  voltageState?: number;
  /** Official SDK key: `firmwareUpgradeStatus` (Advanced2 data[11], V6) */
  firmwareUpgradeStatus?: number;
  /** Official SDK key: `cutterStatus` (Advanced2 data[14], V6) */
  cutterStatus?: number;
  /** Official SDK key: `wifiUpgradeStatus` (Advanced2 data[15], V6) */
  wifiUpgradeStatus?: number;
  /** Official SDK key: `bluetoothUpgradeStatus` (Advanced2 data[16], V6) */
  bluetoothUpgradeStatus?: number;
  /** Official SDK key: `numberOfFaultEventFrames` (Advanced2 data[18]) */
  faultEventFrames?: number;
}

/**
 * @category Packets
 */
export interface SoundSettings {
  category: SoundSettingsType;
  item: SoundSettingsItemType;
  value: boolean;
}

/**
 * @category Packets
 */
export interface PrinterStatusData {
  supportColor: number;
  protocolVersion: number;
  /** Official SDK: data[11] — protocol major version */
  versionMajor?: number;
  /** Official SDK: data[12] — protocol minor version */
  versionMinor?: number;
  /** Official SDK: data[2..3] u16 — printer row cache (pages shorter than this are sent once with copy count) */
  cacheRows?: number;
  /** Official SDK: data[4..5] u16 — rows per data block; the printer answers 0xD3 after each block */
  blockRows?: number;
  /** Official SDK printer class chosen from 0xC2 / 0xA5 (connectBluetoothPrinter) */
  officialClass?: OfficialPrinterClass;
}

/**
 * Printer protocol class of the official SDK (libjcPrinterSdk cPrinterV3..V6).
 * @category Packets
 */
export type OfficialPrinterClass = "V3" | "V4" | "V5" | "V6";

/**
 * Official SDK class selection (connectBluetoothPrinter):
 * - 0xC2 data[0] != 3 → (0, data[0]); == 3 → version from 0xA5 data[11].data[12]
 *   (major ≥ 3 as is; major == 2 && minor ≥ 3 → (2, minor); otherwise (0, 3))
 * - major ≥ 3: minor < 2 → V5, else V6
 * - major < 3 (B1 family): minor == 3 → V3, else V4
 * @category Packets
 */
export const officialPrinterClass = (connectResult: number, major?: number, minor?: number): OfficialPrinterClass => {
  let ma = 0;
  let mi = connectResult;
  if (connectResult === 3) {
    if (major !== undefined && minor !== undefined && (major >= 3 || (major === 2 && minor >= 3))) {
      ma = major;
      mi = minor;
    } else {
      ma = 0;
      mi = 3;
    }
  }
  if (ma >= 3) return mi < 2 ? "V5" : "V6";
  return mi === 3 ? "V3" : "V4";
};
