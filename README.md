## NiimBlueLib [![NPM](https://img.shields.io/npm/v/@mmote/niimbluelib)](https://npmjs.com/package/@mmote/niimbluelib)

> [!WARNING]
>
> This project is intended for informational and educational purposes only.
> The project is not affiliated with or endorsed by the original software or hardware vendor,
> and is not intended to be used for commercial purposes without the consent of the vendor.

[Documentation](https://niim-docs.pages.dev)

NiimBlueLib is a library for the communication with NIIMBOT printers.
Used in [NiimBlue](https://github.com/MultiMote/niimblue) project.

NiimBlueLib provides the most accurate open source implementation of the NIIMBOT printers protocol.

This project is in Alpha state. Use only exact version when you add it to your project. API can be changed anytime.

Also check out [niimblue-node](https://github.com/MultiMote/niimblue-node) for CLI use cases.

### Installation

NPM:

```bash
npm install -E @mmote/niimbluelib
```

CDN:

```html
<script src="https://unpkg.com/@mmote/niimbluelib@VERSION/dist/umd/niimbluelib.min.js"></script>
```

Script uses `niimbluelib` namespace. Example:

```js
const client = new niimbluelib.NiimbotBluetoothClient();
```

### Usage example

See [example/main.js](example/main.js)

### B1 Pro + 54×80mm 黑標連續紙實測設定

在 Chrome / Edge (Web Bluetooth) 環境下，B1 Pro 配合背面有定位黑標的 54×80mm 連續紙，
以下設定可以**對齊每張黑標、單次傳輸印完整張、不偏移、不分段**：

| 參數 | 值 | 為什麼 |
|---|---|---|
| `canvas.width` | `568` | B1 Pro 印頭 567 dot 寬，向上對 8 的倍數（ImageEncoder 要求 column 為 8 倍數） |
| `canvas.height` | `944` | 80mm × 300 dpi ÷ 25.4 ≈ 944，且為 8 的倍數 |
| `printDirection` | `"top"` | B1 Pro 在 `src/printer_models.ts` 標註的預設方向 |
| `labelType` | `LabelType.Black` | 連續紙背面有黑標，必須讓印表機依黑標對齊每張起點，否則會偏移 |
| `client.setPacketInterval(2)` | `2 ms` | Web Bluetooth 預設 MTU 較小，2 ms 是「不丟包」與「跟上印頭速度」之間的甜蜜點 |

```js
import { NiimbotBluetoothClient, LabelType, ImageEncoder } from "@mmote/niimbluelib";

const client = new NiimbotBluetoothClient();
client.setPacketInterval(2);              // 重要：避免 BLE buffer overrun / underrun
await client.connect();

const canvas = document.querySelector("canvas"); // width=568 height=944
const encoded = ImageEncoder.encodeCanvas(canvas, "top");

const task = client.abstraction.newPrintTask(client.getPrintTaskType() ?? "B1", {
  totalPages: 1,
  statusPollIntervalMs: 100,
  statusTimeoutMs: 8_000,
  labelType: LabelType.Black,             // 黑標紙必須設這個
});

await task.printInit();
await task.printPage(encoded, 1);
await task.waitForPageFinished();
await task.waitForFinished();
await task.printEnd();
```

**排錯**

- 印表機亮紅燈：通常是 `labelType` 設錯或紙裝反。B1 Pro 收到的 `In_PrinterInfoLabelType` 是裝置實際感測到的紙類型，可以拿來校正。
- 偏移：`labelType` 設成 `Continuous` 會跳過黑標偵測，導致每張位置漂移，務必用 `Black`。
- 印一半停一下、紙跑空白才繼續印：BLE 傳輸跟不上印頭速度。`setPacketInterval` 在 0 ~ 6 ms 之間調整：
  - 太小（0 ms）→ Web Bluetooth without-response 無流控，buffer overrun 導致丟包、內容殘缺
  - 太大（≥ 8 ms）→ 印頭比傳輸快，跑紙到一半就在等資料
  - 經驗值：B1 Pro + macOS Chrome **2 ms** 最佳
- 只印 1/4 寬：canvas.width 太小（之前用 240 對 B1 Pro 567 dot 印頭只佔 ~42%）。請用 **568**。
- `SyntaxError: does not provide an export named 'ImageEncoder'`：你用 Vite/Rollup 之類的 ESM bundler，但裝到舊版 lib 只有 CJS。本 fork 已加 ESM 輸出，更新到此版本即可。

### Misc

Eslint not included. Install it with:

```
npm install --no-save --no-package-lock eslint@9.x globals @eslint/js typescript-eslint
```
