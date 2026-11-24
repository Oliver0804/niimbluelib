// RFID 回應（In_RfidInfo 0x1B）解析測試
// fixture 依官方 SDK libjcPrinterSdk rfiddatapro() 的欄位順序組成：
// UUID(8) · barcode(vstr) · batchNumber(vstr) · qestrictionNumber(u16 BE) · usedNumber(u16 BE)
// · paperType(u8) · ratedCapacity(u16 BE) · UUID2(8) · classCode(u32 BE)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NiimbotPacket, parseRfidInfo, SequentialDataReader, ResponseCommandId, LabelType } = require("../dist/cjs");

const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const vstr = (s) => [s.length, ...Buffer.from(s, "ascii")];
const UUID = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
const UUID2 = [0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10];

/** 組出 RFID payload；opt 依序決定要不要帶尾端選填欄位 */
function payload({ barcode = "01162101", batch = "B2026", total = 95, used = 3, type = 5, capacity, uuid2, classCode, extra = [] } = {}) {
  const d = [...UUID, ...vstr(barcode), ...vstr(batch), ...u16(total), ...u16(used), type];
  if (capacity !== undefined) d.push(...u16(capacity));
  if (uuid2) d.push(...uuid2);
  if (classCode !== undefined) d.push(...u32(classCode));
  d.push(...extra);
  return new Uint8Array(d);
}

/** 包成官方外框：55 55 | cmd | len | data | xor | AA AA */
function frame(cmd, data) {
  let x = cmd ^ data.length;
  for (const b of data) x ^= b;
  return new Uint8Array([0x55, 0x55, cmd, data.length, ...data, x, 0xaa, 0xaa]);
}

test("無標籤：len==1", () => {
  const info = parseRfidInfo(new Uint8Array([0x00]));
  assert.equal(info.tagPresent, false);
  assert.equal(info.allPaper, -1);
});

test("舊格式：沒有 ratedCapacity", () => {
  const info = parseRfidInfo(payload());
  assert.equal(info.tagPresent, true);
  assert.equal(info.uuid, "0123456789abcdef");
  assert.equal(info.barCode, "01162101");
  assert.equal(info.serialNumber, "B2026");
  assert.equal(info.allPaper, 95);
  assert.equal(info.usedPaper, 3);
  assert.equal(info.consumablesType, LabelType.Transparent);
  assert.equal(info.capacity, undefined);
  assert.equal(info.uuid2, undefined);
  assert.equal(info.classCode, undefined);
});

test("帶 ratedCapacity", () => {
  const info = parseRfidInfo(payload({ capacity: 95 }));
  assert.equal(info.capacity, 95);
  assert.equal(info.uuid2, undefined);
});

test("官方完整格式：ratedCapacity + UUID2 + classCode（修正前會丟 Extra data left）", () => {
  const info = parseRfidInfo(payload({ capacity: 95, uuid2: UUID2, classCode: 0x01020304 }));
  assert.equal(info.capacity, 95);
  assert.equal(info.uuid2, "fedcba9876543210");
  assert.equal(info.classCode, 0x01020304);
});

test("數值為無號：u16 ≥ 0x8000、u32 ≥ 0x80000000 不會變負數", () => {
  const info = parseRfidInfo(payload({ total: 40000, used: 0xffff, capacity: 0x8001, uuid2: UUID2, classCode: 0xfffffffe }));
  assert.equal(info.allPaper, 40000);
  assert.equal(info.usedPaper, 65535);
  assert.equal(info.capacity, 0x8001);
  assert.equal(info.classCode, 0xfffffffe);
});

test("classCode 不足 4 bytes 時不讀（官方：長度足夠才讀）", () => {
  const info = parseRfidInfo(payload({ capacity: 95, uuid2: UUID2, extra: [0x01, 0x02] }));
  assert.equal(info.uuid2, "fedcba9876543210");
  assert.equal(info.classCode, undefined);
});

test("尾端多出未知欄位不會失敗（新韌體相容）", () => {
  const info = parseRfidInfo(payload({ capacity: 95, uuid2: UUID2, classCode: 7, extra: [0xaa, 0xbb, 0xcc] }));
  assert.equal(info.classCode, 7);
});

test("完整封包：從 0x1B 封包位元組解析", () => {
  const data = payload({ capacity: 95, uuid2: UUID2, classCode: 42 });
  const pkt = NiimbotPacket.fromBytes(frame(ResponseCommandId.In_RfidInfo, data));
  assert.equal(pkt.command, ResponseCommandId.In_RfidInfo);
  const info = parseRfidInfo(pkt.data);
  assert.equal(info.barCode, "01162101");
  assert.equal(info.classCode, 42);
});

test("SequentialDataReader：readU16 / readU32 支援 subarray 位移", () => {
  const base = new Uint8Array([0x99, 0x80, 0x01, 0xff, 0xff, 0xff, 0xfe]);
  const r = new SequentialDataReader(base.subarray(1));
  assert.equal(r.readU16(), 0x8001);
  assert.equal(r.readU32(), 0xfffffffe);
  assert.equal(r.remaining(), 0);
});
