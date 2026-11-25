let invocation: { readonly root: string; readonly source: string; readonly bun: string };

export function selectSource(root: string, source: string, bun: string): void {
  invocation = { root, source, bun };
  process.argv.splice(0, 5, bun, root + source);
}

type PackageMeta = Pick<ImportMeta, "dir" | "url" | "main"> & { readonly bun: string; readonly resolve: (specifier: string) => string };

export function packageMeta(source: string): PackageMeta {
  const file = invocation.root + source;
  const dir = file.slice(0, file.lastIndexOf("/"));
  return {
    bun: invocation.bun,
    main: invocation.source === source,
    dir,
    url: Bun.pathToFileURL(file).href,
    resolve: (specifier: string): string => import.meta.resolve(specifier, Bun.pathToFileURL(file).href),
  };
}
