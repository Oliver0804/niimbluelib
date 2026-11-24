// 以 B1 Pro 實機擷取的封包當 fixture（2026-11-24，韌體 0x0207、硬體 0x0201，透明 50×80 紙捲）
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  NiimbotPacket,
  parseRfidInfo,
  parsePrinterStatusData,
  parseHeartbeatAdvanced2,
  officialPrinterClass,
  OfficialV6PrintTask,
  LabelType,
  RequestCommandId,
} = require("../dist/cjs");

const hex = (s) => new Uint8Array(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const pkt = (s) => NiimbotPacket.fromBytes(hex(s));

const C2 = "55 55 c2 01 03 c0 aa aa";
const B5 = "55 55 b5 10 30 30 0c 1c 00 96 00 00 00 0a 01 03 02 06 22 00 0d aa aa";
const RFID =
  "55 55 1b 29 88 1d 25 01 3b 23 10 80 08 30 31 31 36 32 31 30 31 10 50 43 30 49 41 31 35 33 30 39 30 30 32 36 31 38 00 72 00 05 05 00 5f 22 aa aa";
const HB = "55 55 d9 0d 1f 78 50 4b 00 00 01 00 00 00 00 00 00 a9 aa aa";

test("0xC2：connectResult = 3", () => {
  assert.equal(pkt(C2).data[0], 3);
});

test("0xA5：版本 3.02 → 官方 V6；區塊 150 列、快取 3100 列", () => {
  const s = parsePrinterStatusData(pkt(B5).data);
  assert.equal(s.versionMajor, 3);
  assert.equal(s.versionMinor, 2);
  assert.equal(s.officialClass, "V6");
  assert.equal(s.protocolVersion, 5);
  assert.equal(s.blockRows, 150);
  assert.equal(s.cacheRows, 0x0c1c);
});

test("官方類別判定規則", () => {
  assert.equal(officialPrinterClass(3, 3, 2), "V6");
  assert.equal(officialPrinterClass(3, 3, 1), "V5");
  assert.equal(officialPrinterClass(3, 4, 0), "V5"); // major≥4 && minor<2：官方 V5（niimbluelib pv 給 5）
  assert.equal(officialPrinterClass(3, 2, 4), "V4");
  assert.equal(officialPrinterClass(3, 2, 3), "V3");
  assert.equal(officialPrinterClass(3, 2, 2), "V3"); // 2.02 不符條件 → (0,3)
  assert.equal(officialPrinterClass(3), "V3");
  assert.equal(officialPrinterClass(1), "V4");
  assert.equal(officialPrinterClass(2), "V4");
});

test("0x1B：實機 RFID（無 UUID2/classCode），總張數 114 ≠ 實際 95 張", () => {
  const i = parseRfidInfo(pkt(RFID).data);
  assert.equal(i.uuid, "881d25013b231080");
  assert.equal(i.barCode, "01162101");
  assert.equal(i.serialNumber, "PC0IA15309002618");
  assert.equal(i.allPaper, 114); // 官方 qestrictionNumber
  assert.equal(i.usedPaper, 5);
  assert.equal(i.consumablesType, LabelType.Transparent);
  assert.equal(i.capacity, 95); // 官方 ratedCapacity
  assert.equal(i.uuid2, undefined);
  assert.equal(i.classCode, undefined);
});

test("0xD9：實機心跳 13 bytes", () => {
  const i = parseHeartbeatAdvanced2(pkt(HB).data);
  assert.equal(i.chargeLevel, 0x50);
  assert.equal(i.lidClosed, true);
  assert.equal(i.paperInserted, true);
  assert.equal(i.paperRfidSuccess, true);
  assert.equal(i.firmwareUpgradeStatus, 0);
  assert.equal(i.lightingErrorCode, 0);
  assert.equal(i.cutterStatus, undefined);
});

test("OfficialV6PrintTask：45B SetPageSize、無 PageStart、無 0x83、每 150 列等 0xD3", async () => {
  const sent = [];
  let acks = 0;
  const client = {
    getPrinterInfo: () => ({ blockRows: 150 }),
    getModelMetadata: () => ({ printheadPixels: 567 }),
    waitForPacket: () => {
      acks++;
      return Promise.resolve(null);
    },
  };
  const abstraction = {
    getClient: () => client,
    sendAll: async (ps) => sent.push(...ps),
    setPacketTimeout() {},
    setDefaultPacketTimeout() {},
  };
  const task = new OfficialV6PrintTask(abstraction, { totalPages: 1 });
  // 579 列（實機那張 Ø49 標籤的高度），每列 3 個黑點（會觸發 0x83 的條件）
  const rowsData = Array.from({ length: 579 }, (_, r) => {
    const rowData = new Uint8Array(71);
    rowData[10] = 0b10101000;
    return { dataType: "pixels", rowNumber: r, repeat: 1, rowData, blackPixelsCount: 3 };
  });
  await task.printPage({ cols: 568, rows: 579, rowsData }, 1);

  const cmds = sent.map((p) => p.command);
  assert.equal(cmds[0], RequestCommandId.SetPageSize);
  assert.equal(sent[0].data.length, 45);
  assert.ok(!cmds.includes(RequestCommandId.PageStart));
  assert.ok(!cmds.includes(RequestCommandId.PrintBitmapRowIndexed));
  assert.equal(cmds.at(-1), RequestCommandId.PageEnd);
  assert.equal(acks, 3); // 4 個區塊（0–149、150–299、300–449、450–578），最後一塊在 PageEnd 後才回 0xD3
});
