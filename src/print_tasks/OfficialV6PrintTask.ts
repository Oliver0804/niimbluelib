import { EncodedImage } from "../image_encoder";
import { PacketGenerator, ResponseCommandId } from "../packets";
import { AbstractPrintTask } from "./AbstractPrintTask";

/**
 * Print task following the official SDK cPrinterV6 commitJob (libjcPrinterSdk, static analysis):
 *
 * - PrintStart 9 bytes (last byte always 0)
 * - no PageStart
 * - SetPageSize 45 bytes (13-byte header + 32 bytes EPC / zero fill)
 * - bitmap rows 0x85 / 0x84 only (the official SDK never sends 0x83)
 * - block flow control: after every `blockRows` rows (0xA5 data[4..5]) wait for the printer's 0xD3
 *   before sending the next block; the last (partial) block is acknowledged after PageEnd
 * - PrintEnd retried while the printer is busy (see {@link AbstractPrintTask.printEnd})
 *
 * Experimental: B1 Pro reports protocol 3.02 (→ V6 in the official SDK); B1 and D110M_V4 tasks are also known to work.
 *
 * @category Print tasks
 */
export class OfficialV6PrintTask extends AbstractPrintTask {
  /** Wait at most this long for each 0xD3 block acknowledgement before continuing anyway */
  static blockAckTimeoutMs = 10_000;

  override printInit(): Promise<void> {
    return this.abstraction.sendAll([
      PacketGenerator.setDensity(this.printOptions.density),
      PacketGenerator.setLabelType(this.printOptions.labelType),
      PacketGenerator.printStart9b(this.printOptions.totalPages, this.printOptions.color, this.printOptions.speed, false),
    ]);
  }

  override async printPage(image: EncodedImage, quantity?: number): Promise<void> {
    this.checkAddPage(quantity ?? 1);
    const client = this.abstraction.getClient();
    const blockRows = client.getPrinterInfo().blockRows || 0;
    const timeout = this.printOptions.pageTimeoutMs;

    await this.abstraction.sendAll([PacketGenerator.setPageSize45b(image.rows, image.cols, quantity ?? 1)], timeout);

    const imgOpts = { printheadPixels: this.printheadPixels(), noIndexPacket: true };

    if (blockRows <= 0) {
      await this.abstraction.sendAll(PacketGenerator.writeImageData(image, imgOpts), timeout);
    } else {
      // Split rows into blocks of blockRows (by row number) like the official processOneColorImageData
      const blocks = new Map<number, EncodedImage["rowsData"]>();
      for (const row of image.rowsData) {
        const b = Math.floor(row.rowNumber / blockRows);
        if (!blocks.has(b)) blocks.set(b, []);
        blocks.get(b)!.push(row);
      }
      const keys = [...blocks.keys()].sort((a, b) => a - b);

      for (let i = 0; i < keys.length; i++) {
        const isLast = i === keys.length - 1;
        // Register the listener before sending so a fast 0xD3 is not missed
        const ack = isLast
          ? null
          : client
              .waitForPacket([ResponseCommandId.In_PrinterCheckLine], true, OfficialV6PrintTask.blockAckTimeoutMs)
              .catch((e: unknown) => {
                if (e instanceof Error && e.message.startsWith("Timeout")) {
                  console.warn(`No 0xD3 after block ${i}, continuing`);
                  return null;
                }
                throw e;
              });

        const sub: EncodedImage = { ...image, rowsData: blocks.get(keys[i])! };
        await this.abstraction.sendAll(PacketGenerator.writeImageData(sub, imgOpts), timeout);
        if (ack) await ack;
      }
    }

    await this.abstraction.sendAll([PacketGenerator.pageEnd()], timeout);
  }

  override waitForFinished(): Promise<void> {
    this.abstraction.setPacketTimeout(this.printOptions.statusTimeoutMs);

    return this.abstraction
      .waitUntilPrintFinishedByStatusPoll(this.printOptions.totalPages ?? 1, this.printOptions.statusPollIntervalMs)
      .finally(() => this.abstraction.setDefaultPacketTimeout());
  }
}
