// Implemented by: diagrams + report agent.
// See docs/ARCHITECTURE.md "Module Contracts" for the required exports:
//   renderMarkdownReport(result: AnalysisResult): string
//   renderHtmlViewer(markdown: string, diagrams: DiagramSet): string
//   writeReportToDisk(outDir: string, markdown: string, html: string): Promise<{ mdPath: string; htmlPath: string }>
export { renderMarkdownReport } from './markdown.js';
export { renderHtmlViewer, markdownToHtml } from './html.js';
export { writeReportToDisk } from './write.js';
