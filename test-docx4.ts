import { md2docx } from '@m2d/md2docx';
import { WidthType, TableLayoutType } from 'docx';
import * as fs from 'fs';

async function run() {
  const md = "| A | B |\n|---|---|\n| 1 | 2 |";
  const blob1 = await md2docx(md, {}, {}, 'nodebuffer', { 
    table: { 
      tableProps: { width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.AUTOFIT },
      cellProps: { width: { size: 0, type: WidthType.AUTO } }
    } 
  });
  fs.writeFileSync('test4.docx', blob1 as any);
}
run().catch(console.error);
