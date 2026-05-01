import { Table, TableRow, TableCell, Paragraph, WidthType, Packer, Document } from "docx";
import * as fs from "fs";

async function run() {
  const row = new TableRow({ children: [new TableCell({ children: [new Paragraph("A")] })] });
  const t1 = new Table({ width: { size: 5000, type: WidthType.PERCENTAGE }, rows: [row] });
  const t2 = new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [row] });

  const doc = new Document({ sections: [{ children: [t1, t2] }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync("test-width.docx", buffer);
}
run().catch(console.error);
