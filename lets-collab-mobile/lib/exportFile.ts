import { Alert } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes `content` to a cache file (expo-file-system v57 File API) and returns its URI. */
export function writeExportFile(fileName: string, content: string) {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
}

/** Opens the system share sheet for an exported file. */
export async function shareExport(uri: string, label: string) {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri);
  } else {
    Alert.alert('Export saved', `${label} written to ${uri}`);
  }
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const cell = (value: string | number | boolean | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [header.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\n');
}
