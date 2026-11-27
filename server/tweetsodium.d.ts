declare module 'tweetsodium' {
  export function seal(messageBytes: Uint8Array, keyBytes: Uint8Array): Uint8Array;
  const tweetsodium: {
    seal: typeof seal;
  };
  export default tweetsodium;
}
