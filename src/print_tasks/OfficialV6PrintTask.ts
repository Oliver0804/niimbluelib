import { EncodedImage, Utils } from "../utils";
import { PacketGenerator, ResponseCommandId } from "../packets";
import { AbstractPrintTask } from "./AbstractPrintTask";

/**
 * Print task following the official SDK cPrinterV6 commitJob (libjcPrinterSdk, static analysis).
 * The official SDK selects V6 for printers reporting protocol ≥ 3.02 in 0xA5 (e.g. B1 Pro).
 *
 * - PrintStart 9 bytes (last byte always 0)
 * - no PageStart
 * - SetPageSize 45 bytes (13-byte header + 32-byte "local template data id", zero filled)
 * - bitmap rows 0x85 / 0x84 only (the official SDK never sends 0x83)
 * - block flow control: after every `blockRows` rows (0xA5 data[4..5]) wait for the printer's 0xD3
 *   before sending the next block; the last (partial) block is acknowledged after PageEnd
 * - PrintEnd retried while the printer answers 0 (30 × 500ms, jcSetPrintTerminal)
 *
 * Experimental (fork only): not selected automatically. B1 Pro is also known to work with the B1 and D110M_V4 tasks.
 *
 * @category Print tasks
 */
export class OfficialV6PrintTask extends AbstractPrintTask {
  /** Wait at most this long for each 0xD3 block acknowledgement before continuing anyway */
  static blockAckTimeoutMs = 10_000;

  override printInit(): Promise<void> {
    return this.protocol.sendAll([
      PacketGenerator.setLabelType(this.printOptions.labelType),
      PacketGenerator.setDensity(this.printOptions.density),
      PacketGenerator.printStart9b(this.printOptions.totalPages, this.printOptions.pageColor, this.printOptions.speed, false),
    ]);
  }

  override async printPage(image: EncodedImage, quantity?: number): Promise<void> {
    this.validatePage(image, quantity ?? 1);
    const client = this.protocol.getClient();
    const blockRows = client.getPrinterInfo().blockRows || 0;
    const timeout = this.printOptions.pageTimeoutMs;
    const progress = this.makePacketProgressCallback();

    await this.protocol.sendAll(
      [PacketGenerator.setPageSize13b(image.rows, image.cols, quantity ?? 1, 0, 0, 0, 0, new Array(32).fill(0))],
      timeout,
    );

    const imgOpts = { printheadPixels: this.printheadPixels(), noIndexPacket: true };

    // Split rows into blocks of blockRows (by row number) like the official processOneColorImageData
    const blocks: EncodedImage["rowsData"][] = [];
    for (const row of image.rowsData) {
      const b = blockRows > 0 ? Math.floor(row.rowNumber / blockRows) : 0;
      (blocks[b] ??= []).push(row);
    }
    const chunks = blocks.filter((b) => b !== undefined);
    const packets = chunks.map((rowsData) => PacketGenerator.writeImageData({ ...image, rowsData }, imgOpts));
    const total = packets.reduce((n, p) => n + p.length, 0);
    let sent = 0;

    for (let i = 0; i < packets.length; i++) {
      const isLast = i === packets.length - 1;
      // Register the listener before sending so a fast 0xD3 is not missed
      const ack =
        isLast || blockRows <= 0
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

      await this.protocol.sendAll(packets[i], timeout, (cur) => progress(sent + cur, total));
      sent += packets[i].length;
      if (ack) await ack;
    }

    await this.protocol.sendAll([PacketGenerator.pageEnd()], timeout);
  }

  override waitForFinished(): Promise<void> {
    this.protocol.setPacketTimeout(this.printOptions.statusTimeoutMs);

    return this.protocol
      .waitUntilPrintFinishedByStatusPoll(this.printOptions.totalPages ?? 1, this.printOptions.statusPollIntervalMs)
      .finally(() => this.protocol.setDefaultPacketTimeout());
  }

  override async printEnd(): Promise<boolean> {
    let result = false;
    for (let i = 0; i < 30 && !result; i++) {
      if (i > 0) await Utils.sleep(500);
      result = await this.protocol.printEnd();
    }
    this.emitPrintEndEvent();
    return result;
  }
}
