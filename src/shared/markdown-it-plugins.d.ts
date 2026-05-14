/**
 * Ambient module declarations for markdown-it plugins that don't ship types.
 *
 * This file is a *script* (no top-level import/export) on purpose — that lets
 * `declare module 'x';` register a brand-new ambient module instead of being
 * interpreted as module augmentation (which is what would happen if this were
 * a module file with `export {}`).
 *
 * Each plugin is declared loose (`any`) because the call sites only consume
 * the default export and pass it to `MarkdownIt.use(plugin)`; bespoke typings
 * would be a maintenance burden for zero practical benefit.
 */
declare module 'markdown-it-attrs';
declare module 'markdown-it-emoji';
declare module 'markdown-it-container';
declare module 'markdown-it-abbr';
declare module 'markdown-it-ins';
declare module 'markdown-it-sup';
declare module 'markdown-it-sub';
declare module 'markdown-it-mark';
declare module 'markdown-it-footnote';
declare module 'markdown-it-deflist';
declare module 'markdown-it-task-lists';
declare module 'markdown-it-texmath';
