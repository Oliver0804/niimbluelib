import {
  AutoShutdownTime,
  ConnectResult,
  LabelType,
  ResolutionClass,
  SoundSettingsItemType,
  SoundSettingsType,
} from "./enumerations";

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
  batteryPercents?: number;
  printheadWidth?: number;
  supportColor?: boolean;
  softwareVersion?: string;
  hardwareVersion?: string;
  resolutionClass?: ResolutionClass;
  /** For protocol v4+ */
  capabilities?: PrinterCapabilities;
  /** Printer class chosen by the official SDK (V3..V6) */
  officialClass?: OfficialPrinterClass;
  /** Rows per data block (0xA5 data[4..5]) */
  blockRows?: number;
  /** Printer row cache (0xA5 data[2..3]) */
  cacheRows?: number;
  settings: PrinterSettings;
}

/**
 * Interface representing printer information.
 *
 * @category Client
 */
export interface ConnectNegotiateResult {
  connectResult: ConnectResult;
  protocolVersion: number;
  supportColor: boolean;
  officialClass?: OfficialPrinterClass;
  blockRows?: number;
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

  error: number;
}

/**
 * @category Packets
 */
export interface RfidInfo {
  tagPresent: boolean;
  /** Official SDK key: `UUID` */
  uuid: string;
  /** Official SDK key: `UUID2` */
  uuid2?: string;
  /** Official SDK key: `barcode` (used as `oneCode` for the NIIMBOT cloud label lookup) */
  barCode: string;
  /** Official SDK key: `batchNumber` */
  serialNumber: string;
  /**
   * Official SDK key: `qestrictionNumber` (sic). This is a usage limit, not the label count:
   * a 95-label B1 Pro roll reports 114 here and 95 in {@link capacity}.
   */
  allPaper: number;
  /** Official SDK key: `usedNumber` */
  usedPaper: number;
  /** Official SDK key: `paperType` */
  consumablesType: LabelType;
  /** Official SDK key: `ratedCapacity` — the actual label count of the roll */
  capacity?: number;
  /** Official SDK key: `classCode` (u32 BE, read only when 4 more bytes are available) */
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
  batteryPercents?: number;

  temp?: number;
  ribbonInserted?: boolean;
  ribbonRfidSuccess?: boolean;

  wifiRssi?: number;
  lightingErrorCode?: number;
  /** Official SDK key: `adapterVoltageStatus` (data[13]) */
  voltageState?: number;
  /** Official SDK key: `firmwareUpgradeStatus` (data[11]) */
  firmwareUpgradeStatus?: number;
  /** Official SDK key: `cutterStatus` (data[14]) */
  cutterStatus?: number;
  /** Official SDK key: `wifiUpgradeStatus` (data[15]) */
  wifiUpgradeStatus?: number;
  /** Official SDK key: `bluetoothUpgradeStatus` (data[16]) */
  bluetoothUpgradeStatus?: number;
  /** Official SDK key: `numberOfFaultEventFrames` (data[18]) */
  faultEventFrames?: number;
}

/**
 * @category Packets
 */
export interface HeartbeatPrinterInfoData {
  softwareVersion: string;
  hardwareVersion: string;
  printheadWidth: number;
  resolutionClass: ResolutionClass;
  printheadAlignment: number;
  supportsRFID: boolean;
  supportsWriteRFID: boolean;
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
  supportColor: boolean;
  protocolVersion: number;
  /** data[11] */
  versionMajor?: number;
  /** data[12] */
  versionMinor?: number;
  /** data[2..3] u16: printer row cache (official SDK sends short pages once with the copy count) */
  cacheRows?: number;
  /** data[4..5] u16: rows per data block; the printer answers 0xD3 after each block */
  blockRows?: number;
  /** Printer class chosen by the official SDK, see {@link officialPrinterClass} */
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
      mi = 3;
    }
  }
  if (ma >= 3) return mi < 2 ? "V5" : "V6";
  return mi === 3 ? "V3" : "V4";
};

/**
 * @category Client
 */
export type CombinedRfidInfo = {
  labelRfidInfo?: RfidInfo;
  paperInfo?: PaperInfo;
  ribbonRfidInfo?: RfidInfo;
};

/**
 * @category Packets
 */
export interface PaperInfo {
  valid: boolean;
  gapHeightPixel?: number;
  totalHeightPixel?: number;
  paperType?: LabelType;
  gapHeight?: number;
  totalHeight?: number;
  paperWidthPixel?: number;
  paperWidth?: number;
  paperHeightPixel?: number;
  paperHeight?: number;
  direction?: number;
  tailLengthPixel?: number;
  tailLength?: number;
}

export type ValueRange = {
  max: number;
  min: number;
};

export interface PrinterCapabilities {
  language?: number[];
  printMode?: number[];
  uhfRfid?: number[];
  /** 200 (not 203) or 300 */
  printheadDpi?: number;
  rfidSupport?: number[];
  batteryRange?: ValueRange;
  densityRange?: ValueRange;
  speedRange?: ValueRange;
  supportedLabelTypes?: number[];
  printheadWidth?: number;
  maxPrintHeight?: number;
  labelHeightAndGap?: number;
  printheadPosition?: number;
  volumeSupport?: number[];
  hostStyle?: number[];
  printProtocol?: number[];
  autoShutdownRange?: ValueRange;
  cutterSupport?: number[];
  cutterDepthRange?: ValueRange;
  printControl?: number[];
  pauseTimeSupport?: number[];
  paperDetection?: number;
  realTimeClock?: number[];
  keyFunctions?: Array<{ key: number; functions: number[] }>;
  unknown19?: number;
  printColor?: number[];
  speedQualityMode?: number[];
  tubeCalibration?: number[];
  partialRetransmitSupport?: number[];
  maxCompressLines?: number;
  tubeSupport?: number[];
  sixteenGrayMaxBuffer?: number;
  localTemplateSupport?: number[];
  imageCompressSupport?: number[];
  maxImageCompressBytes?: number;
  localTemplateMaxTimeCount?: number;
}

export interface PrinterSettings {
  powerSound: boolean;
  connectionSound: boolean;
  autoShutdownTime: AutoShutdownTime;
}
