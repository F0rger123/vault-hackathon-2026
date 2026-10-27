interface Node {
  name: string;
  folders: Map<string, Node>;
  files: string[];
  count: number;
}

function build(paths: string[]): Node {
  const root: Node = { name: "", folders: new Map(), files: [], count: 0 };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    const file = parts.pop();
    let node = root;
    node.count += 1;
    for (const part of parts) {
      let next = node.folders.get(part);
      if (!next) {
        next = { name: part, folders: new Map(), files: [], count: 0 };
        node.folders.set(part, next);
      }
      next.count += 1;
      node = next;
    }
    if (file) node.files.push(file);
  }
  return root;
}

function FolderIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 14" className="h-3.5 w-4 shrink-0 text-blue">
      <path d="M1 2.5h5l1.5 1.5H15v8.5H1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

const FILE_LIMIT = 12;

function Branch({ node, depth }: { node: Node; depth: number }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className={depth > 0 ? "ml-2 border-l border-line pl-3" : ""}>
      {folders.map((f) => (
        <li key={f.name} className="py-0.5">
          <details open={depth === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-control py-0.5 text-sm hover:text-blue [&::-webkit-details-marker]:hidden">
              <FolderIcon />
              <span className="font-medium">{f.name}</span>
              <span className="text-xs text-muted tabular-nums">{f.count}</span>
            </summary>
            <Branch node={f} depth={depth + 1} />
          </details>
        </li>
      ))}
      {node.files.slice(0, FILE_LIMIT).map((file, i) => (
        <li key={`${file}-${i}`} className="truncate py-0.5 font-mono text-[12.5px] text-muted">
          {file}
        </li>
      ))}
      {node.files.length > FILE_LIMIT && (
        <li className="py-0.5 text-xs text-muted">and {node.files.length - FILE_LIMIT} more files</li>
      )}
    </ul>
  );
}

/** Preview of an export as a folder tree. Top-level folders start open. */
export function FolderTree({ paths }: { paths: string[] }) {
  const root = build(paths);
  return (
    <div className="max-h-96 overflow-y-auto">
      <Branch node={root} depth={0} />
    </div>
  );
}
