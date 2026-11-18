// The Khronos gltf-validator package ships no type declarations; this covers what we use.
declare module "gltf-validator" {
  interface Message {
    code: string;
    message: string;
    severity: number; // 0 error, 1 warning, 2 information, 3 hint
    pointer?: string;
  }
  interface Report {
    issues: { numErrors: number; numWarnings: number; messages: Message[] };
  }
  interface Options {
    uri?: string;
    format?: "glb" | "gltf";
    maxIssues?: number;
    ignoredIssues?: string[];
    severityOverrides?: Record<string, number>;
    externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }
  const validator: {
    validateBytes(data: Uint8Array, options?: Options): Promise<Report>;
    version(): string;
  };
  export default validator;
}
