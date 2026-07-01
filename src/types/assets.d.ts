// Static image asset imports (Metro returns an opaque asset id usable as an Image source).
declare module '*.png' {
  const content: number;
  export default content;
}
declare module '*.jpg' {
  const content: number;
  export default content;
}
