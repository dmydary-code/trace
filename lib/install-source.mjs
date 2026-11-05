// Permit automatic source replacement only between releases of this Homebrew package.
export function isTraceBrewMigration(previous, next) {
  const pattern = /^(\/opt\/homebrew|\/usr\/local|\/home\/linuxbrew\/\.linuxbrew)\/(?:Cellar\/(?:trace|trace-review)\/[^/]+|opt\/(?:trace|trace-review))\/libexec\/?$/;
  const oldRoot = previous?.match(pattern), newRoot = next?.match(pattern);
  return !!oldRoot && !!newRoot && oldRoot[1] === newRoot[1];
}

export function stableTraceRoot(root) {
 const match=root.match(/^(\/opt\/homebrew|\/usr\/local|\/home\/linuxbrew\/\.linuxbrew)\/(?:Cellar\/(?:trace|trace-review)\/[^/]+|opt\/(?:trace|trace-review))\/libexec\/?$/);
 return match ? `${match[1]}/opt/trace-review/libexec` : root;
}
