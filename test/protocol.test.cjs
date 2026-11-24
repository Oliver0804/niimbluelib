// 依官方 SDK（libjcPrinterSdk）對齊的協定測試：心跳、列印狀態、指令產生器、任務對應
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseHeartbeatAdvanced2,
  PacketGenerator,
  RequestCommandId,
  ResponseCommandId,
  findPrintTask,
  PrinterModel,
} = require("../dist/cjs");

const hb = (len) => {
  // data[2]=power 3, [4]=cap 0, [5]=paper 0, [6]=rfid 1, [7]=ribbonRfid 0, [8]=ribbon 1, [9..10]=rssi -40,
  // [11..18] = 11..18
  const d = new Uint8Array(len);
  d[2] = 3; d[4] = 0; d[5] = 0; d[6] = 1; d[7] = 0; d[8] = 1;
  if (len > 10) { d[9] = 0xff; d[10] = 0xd8; }
  for (let i = 11; i < len; i++) d[i] = i;
  return d;
};

test("心跳 Advanced2：9 bytes（V4）", () => {
  const i = parseHeartbeatAdvanced2(hb(9));
  assert.equal(i.chargeLevel, 3);
  assert.equal(i.lidClosed, true);
  assert.equal(i.paperInserted, true);
  assert.equal(i.paperRfidSuccess, true);
  assert.equal(i.ribbonInserted, false);
  assert.equal(i.wifiRssi, undefined);
});

test("心跳 Advanced2：11 bytes（V5，wifiRssi 有號）", () => {
  assert.equal(parseHeartbeatAdvanced2(hb(11)).wifiRssi, -40);
});

test("心跳 Advanced2：≥15 bytes 不再丟 Extra data left，並讀出 V6 欄位", () => {
  const i = parseHeartbeatAdvanced2(hb(20));
  assert.equal(i.firmwareUpgradeStatus, 11);
  assert.equal(i.lightingErrorCode, 12);
  assert.equal(i.voltageState, 13);
  assert.equal(i.cutterStatus, 14);
  assert.equal(i.wifiUpgradeStatus, 15);
  assert.equal(i.bluetoothUpgradeStatus, 16);
  assert.equal(i.faultEventFrames, 18);
});

test("心跳 Advanced2：14 bytes（原本就支援的長度）結果不變", () => {
  const i = parseHeartbeatAdvanced2(hb(14));
  assert.equal(i.lightingErrorCode, 12);
  assert.equal(i.voltageState, 13);
  assert.equal(i.cutterStatus, undefined);
});

test("printStart8b：官方 V5 格式 pages u16, 0,0,0,0, color, mode", () => {
  const p = PacketGenerator.printStart8b(3, 0, 1);
  assert.equal(p.command, RequestCommandId.PrintStart);
  assert.deepEqual([...p.data], [0, 3, 0, 0, 0, 0, 0, 1]);
});

test("setPageSize45b：前 13 bytes 同 13b，後 32 bytes 補零 / EPC", () => {
  const p13 = PacketGenerator.setPageSize13b(944, 568, 2);
  const p45 = PacketGenerator.setPageSize45b(944, 568, 2);
  assert.equal(p45.data.length, 45);
  assert.deepEqual([...p45.data.subarray(0, 13)], [...p13.data]);
  assert.ok(p45.data.subarray(13).every((b) => b === 0));
  const epc = PacketGenerator.setPageSize45b(944, 568, 2, 0, 0, 0, 0, new Uint8Array([0xaa, 0xbb]));
  assert.deepEqual([...epc.data.subarray(13, 16)], [0xaa, 0xbb, 0]);
});

test("指令名稱：反查顯示官方名稱，舊名稱仍可用", () => {
  assert.equal(RequestCommandId[0x59], "GetPaperParam");
  assert.equal(RequestCommandId[0x5a], "PaperMeasurement");
  assert.equal(RequestCommandId.CalibrateHeight, 0x59);
  assert.equal(ResponseCommandId[0x69], "In_GetPaperParam");
  assert.equal(PacketGenerator.mapped(RequestCommandId.GetPaperParam).command, 0x59);
});

test("B1 Pro 預設列印任務維持原作者的 D110M_V4", () => {
  assert.equal(findPrintTask(PrinterModel.B1_PRO), "D110M_V4");
  assert.equal(findPrintTask(PrinterModel.B21_PRO), "D110M_V4");
});
