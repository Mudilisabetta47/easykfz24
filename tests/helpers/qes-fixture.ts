// Synthetisches, strukturell korrekt signiertes PDF (PAdES-Aufbau) für Tests der technischen Vorprüfung – keine echte
// Signatur: Der „CMS“-Block enthält nur messageDigest und die EU-Kennzeichen (QcCompliance, QSCD), wie ein echter Block.

import { createHash } from 'node:crypto';

const QC = Buffer.from([0x06, 0x06, 0x04, 0x00, 0x8e, 0x46, 0x01, 0x01]);
const QSCD = Buffer.from([0x06, 0x06, 0x04, 0x00, 0x8e, 0x46, 0x01, 0x04]);

export function signedPdf(opts: { reference?: string; qc?: boolean; qscd?: boolean } = {}): Uint8Array {
  const pad = (n: number) => String(n).padStart(10, '0');
  const head = (b: number, c: number, d: number) =>
    `%PDF-1.7\n1 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/ETSI.CAdES.detached/ByteRange [0 ${pad(b)} ${pad(c)} ${pad(d)}]/Contents `;
  const tail = `>>\nendobj\n2 0 obj\n(Vollmacht ${opts.reference ?? ''})\nendobj\n%%EOF\n`;
  const cmsLen = 120;
  const hole = `<${'0'.repeat(cmsLen * 2)}>`;
  const b = head(0, 0, 0).length;
  const c = b + hole.length;
  const pre = head(b, c, tail.length);
  const digest = createHash('sha256')
    .update(Buffer.concat([Buffer.from(pre, 'latin1'), Buffer.from(tail, 'latin1')]))
    .digest();
  const cms = Buffer.alloc(cmsLen);
  let o = 0;
  for (const part of [
    Buffer.from([0x30, 0x80]),
    opts.qc === false ? Buffer.alloc(0) : QC,
    opts.qscd === false ? Buffer.alloc(0) : QSCD,
    Buffer.from([0x04, 0x20]),
    digest,
  ]) {
    part.copy(cms, o);
    o += part.length;
  }
  return new Uint8Array(Buffer.from(pre + `<${cms.toString('hex')}>` + tail, 'latin1'));
}

export const plainPdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%Bericht\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1'));
