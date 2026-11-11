// Reads a picked File as a data: URL for local, serverless storage (localForage/IndexedDB).
// Originally written inline in AddressBookDetail.tsx for the contact icon/cover picker;
// pulled out here so AssetRecoveryForm/AssetRecoveryList's chain/token icon pickers can
// share the exact same behavior instead of re-implementing it.
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
