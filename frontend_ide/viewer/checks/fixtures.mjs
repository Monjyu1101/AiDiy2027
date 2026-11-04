// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// 文書ビューア検証用の最小ファイル。呼び出し元が指定する一時フォルダだけへ生成する。
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import XLSX from 'xlsx';

export async function createFixtures(root) {
  await mkdir(root, { recursive: true });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>AiDiy IDE 文書ビューア</w:t></w:r></w:p><w:p><w:r><w:t>Wordの日本語表示を確認します。</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>2ページ目：読み取り専用です。</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
  await writeFile(join(root, '日本語文書.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['商品', '数量', '単価', '金額'], ['サンプル商品', 3, 1200, 3600], ['<img src=x onerror=alert(1)>', 1, 20, 20]]);
  sheet.D2 = { t: 'n', v: 3600, f: 'B2*C2', z: '#,##0' };
  sheet['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(book, sheet, '売上一覧');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 205 }, (_, i) => [i + 1, `明細 ${i + 1}`])), '明細');
  const merged = XLSX.utils.aoa_to_sheet([['結合セル'], [], ['通常のセル']]);
  merged['!merges'] = [XLSX.utils.decode_range('A1:C2')];
  XLSX.utils.book_append_sheet(book, merged, '結合確認');
  await writeFile(join(root, '売上.xlsx'), XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  await writeFile(join(root, '一覧.csv'), '商品,数量\nサンプル,3\n');
  await writeFile(join(root, 'broken.docx'), 'not a zip');
  await writeFile(join(root, 'sample.js'), '// Monaco 切り替え確認\nconst message = "AiDiy IDE";\n');
  const streams = ['BT /F1 24 Tf 60 740 Td (AiDiy IDE PDF - Page 1) Tj ET', 'BT /F1 24 Tf 60 740 Td (Read-only preview - Page 2) Tj ET'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(join(root, 'sample.pdf'), pdf);
}
