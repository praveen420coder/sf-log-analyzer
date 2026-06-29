// Salesforce record-Id helpers: validation, checksum, and key-prefix labels.

const ID_CHECKSUM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

// Common key prefixes → friendly label (nice-to-have; the real object name comes
// from the detail fetch). Not exhaustive — unknown prefixes still open fine.
export const COMMON_PREFIXES: Record<string, string> = {
  '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity',
  '00Q': 'Lead', '500': 'Case', '701': 'Campaign', '800': 'Contract',
  '0WO': 'Order', '00T': 'Task', '00U': 'Event', '02s': 'Email Message',
};

// Recomputes the 3-char checksum suffix from the 15-char base of a record Id.
export function computeIdChecksum(id15: string): string {
  let suffix = '';
  for (let block = 0; block < 3; block++) {
    let flags = 0;
    for (let i = 0; i < 5; i++) {
      const c = id15.charAt(block * 5 + i);
      if (c >= 'A' && c <= 'Z') flags += 1 << i;
    }
    suffix += ID_CHECKSUM_ALPHABET.charAt(flags);
  }
  return suffix;
}

// 15-char Ids are accepted on format; 18-char Ids are verified via their checksum.
export function isValidSalesforceId(value: string): boolean {
  if (!value) return false;
  if (value.length === 15) return /^[a-zA-Z0-9]{15}$/.test(value);
  if (value.length === 18) {
    if (!/^[a-zA-Z0-9]{18}$/.test(value)) return false;
    return computeIdChecksum(value.substring(0, 15)) === value.substring(15).toUpperCase();
  }
  return false;
}
