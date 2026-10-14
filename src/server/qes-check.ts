// Technische Vorprüfung eines signierten PDF (PAdES/CMS) – ohne externe Bibliothek, rein lesend. Ersetzt KEINE
// Signaturvalidierung (Zertifikatskette, Sperrstatus, EU-Vertrauensliste): Dafür ist der Prüfbericht eines
// Validierungsdienstes Pflicht (src/server/os/poa-evidence.ts). Geprüft wird hier, was sich aus der Datei selbst ergibt:
//   1. Signaturfeld vorhanden (/ByteRange, /Contents, /SubFilter ETSI.CAdES.detached bzw. adbe.pkcs7.detached)
//   2. Die letzte Signatur deckt die gesamte Datei ab (keine Änderungen nach der Unterschrift)
//   3. Der Hash der signierten Bytes steht als messageDigest in der Signatur (Inhalt unverändert)
//   4. Signaturzertifikat mit EU-Qualifizierungskennzeichen: QcCompliance (0.4.0.1862.1.1) und QSCD (0.4.0.1862.1.4)

import { createHash } from 'node:crypto';

export interface QesTechCheck {
  ok: boolean;
  signatures: number;
  subFilter: string;
  coversWholeFile: boolean;
  digestMatches: boolean;
  digestAlgorithm: string;
  qcCompliance: boolean;
  qscd: boolean;
  /** Vorgangskennung (Prozessnummer oder Referenz) im Dokumenttext gefunden – nur Hinweis */
  referenceFound: boolean;
  problems: string[];
}

const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
const OID_QC_COMPLIANCE = Buffer.from([0x06, 0x06, 0x04, 0x00, 0x8e, 0x46, 0x01, 0x01]);
const OID_QC_SSCD = Buffer.from([0x06, 0x06, 0x04, 0x00, 0x8e, 0x46, 0x01, 0x04]);

export function checkSignedPdf(bytes: Uint8Array, refs: string[] = []): QesTechCheck {
  const text = latin1(bytes);
  const problems: string[] = [];
  const out: QesTechCheck = {
    ok: false,
    signatures: 0,
    subFilter: '',
    coversWholeFile: false,
    digestMatches: false,
    digestAlgorithm: '',
    qcCompliance: false,
    qscd: false,
    referenceFound: false,
    problems,
  };
  if (!text.startsWith('%PDF-')) {
    problems.push('Keine PDF-Datei');
    return out;
  }
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => m.slice(1, 5).map(Number));
  out.signatures = ranges.length;
  const sub = /\/SubFilter\s*\/(ETSI\.CAdES\.detached|adbe\.pkcs7\.detached)/.exec(text);
  out.subFilter = sub?.[1] ?? '';
  if (!ranges.length || !out.subFilter) {
    problems.push('Keine elektronische Signatur (PAdES/CMS) im PDF gefunden');
    return out;
  }
  // letzte (äußerste) Signatur: größter Endpunkt
  const [a, b, c, d] = ranges.reduce((x, y) => (y[2] + y[3] > x[2] + x[3] ? y : x));
  out.coversWholeFile = a === 0 && c > b && c + d === bytes.byteLength;
  if (!out.coversWholeFile) problems.push('Die Signatur deckt nicht die gesamte Datei ab – nach der Unterschrift geändert oder unvollständig');
  // Signaturinhalt (/Contents <hex>) zwischen den beiden Bereichen
  const hole = text.slice(b, c);
  const hex = /<([0-9A-Fa-f\s]+)>/.exec(hole)?.[1]?.replace(/\s/g, '') ?? '';
  const cms = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  if (!cms.length) problems.push('Signaturinhalt (/Contents) leer');
  const signed = Buffer.concat([Buffer.from(bytes.subarray(a, a + b)), Buffer.from(bytes.subarray(c, c + d))]);
  for (const alg of ['sha256', 'sha384', 'sha512'] as const) {
    if (cms.includes(createHash(alg).update(signed).digest())) {
      out.digestMatches = true;
      out.digestAlgorithm = alg.toUpperCase();
      break;
    }
  }
  if (!out.digestMatches) problems.push('Hash der signierten Bytes nicht in der Signatur gefunden – Inhalt geändert oder Signaturformat nicht prüfbar');
  out.qcCompliance = cms.includes(OID_QC_COMPLIANCE);
  out.qscd = cms.includes(OID_QC_SSCD);
  if (!out.qcCompliance) problems.push('Signaturzertifikat ohne EU-Kennzeichen „qualifiziert“ (QcCompliance)');
  if (!out.qscd) problems.push('Kein Hinweis auf eine qualifizierte Signaturerstellungseinheit (QSCD)');
  out.referenceFound = refs.some((r) => r && text.includes(r));
  out.ok = out.coversWholeFile && out.digestMatches && out.qcCompliance && out.qscd && cms.length > 0;
  return out;
}
