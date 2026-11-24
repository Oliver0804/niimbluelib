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
  voltageState?: number;
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
}
