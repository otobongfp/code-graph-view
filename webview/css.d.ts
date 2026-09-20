// esbuild loads .css files as text (see esbuild.js); the webview injects them in a <style> element.
declare module '*.css' {
  const content: string;
  export default content;
}
