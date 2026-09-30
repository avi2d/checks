# Usage: git ls-files -- 'tests/*.ts' | awk -v changed=<a,b,...> -v preloads=<a,b,...> -f mutation-readers.awk
# Prints "reader<TAB>changed" for each listed file that imports a changed file,
# directly or through the files it imports, or names a changed fixture's path.
# Bun runs each preload before every test file, so each test file imports it.
# Plain POSIX awk, because the scope step runs before anything is installed.

function resolved(dir, spec,   parts, count, index_, stack, depth, path) {
  count = split(dir "/" spec, parts, "/")
  depth = 0
  for (index_ = 1; index_ <= count; index_++) {
    if (parts[index_] == "..") { if (depth > 0) depth-- }
    else if (parts[index_] != "." && parts[index_] != "") stack[++depth] = parts[index_]
  }
  path = stack[1]
  for (index_ = 2; index_ <= depth; index_++) path = path "/" stack[index_]
  return path
}

function module(path) {
  sub(/\.(ts|tsx|mts|js|mjs)$/, "", path)
  sub(/\/index$/, "", path)
  return path
}

function note(file, line,   rest, spec, needle) {
  rest = line
  while (match(rest, /(from|import)[ \t]*[(]?[ \t]*["'][.][^"']*["']/)) {
    spec = substr(rest, RSTART, RLENGTH)
    rest = substr(rest, RSTART + RLENGTH)
    sub(/^[^"']*["']/, "", spec)
    sub(/["']$/, "", spec)
    imports[++edges] = file
    imported[edges] = module(resolved(directory, spec))
  }
  for (needle in mentions) {
    if (!(file in reached) && (index(line, needle "\"") || index(line, needle "'") || index(line, needle "`") || (mentions[needle] == "file" && index(line, needle)))) {
      reached[file] = fixtureOf[needle]
    }
  }
}

BEGIN {
  preloadCount = split(preloads, preloaded, ",")
  for (each = 1; each <= preloadCount; each++) preloaded[each] = module(resolved("", preloaded[each]))
  count = split(changed, paths, ",")
  for (each = 1; each <= count; each++) {
    path = paths[each]
    reached[path] = path
    if (path !~ /^tests\/fixtures\//) continue
    needle = substr(path, length("tests/") + 1)
    mentions[needle] = "file"
    fixtureOf[needle] = path
    while (sub(/\/[^\/]*$/, "", needle)) {
      if (!(needle in mentions)) { mentions[needle] = "directory"; fixtureOf[needle] = path }
    }
  }
}

{
  file = $0
  directory = file
  sub(/\/[^\/]*$/, "", directory)
  if (file ~ /\.test\.ts$/) {
    for (each = 1; each <= preloadCount; each++) { imports[++edges] = file; imported[edges] = preloaded[each] }
  }
  while ((getline line < file) > 0) note(file, line)
  close(file)
}

END {
  for (file in reached) reachedModule[module(file)] = reached[file]
  grew = 1
  while (grew) {
    grew = 0
    for (edge = 1; edge <= edges; edge++) {
      if (!(imports[edge] in reached) && (imported[edge] in reachedModule)) {
        reached[imports[edge]] = reachedModule[imported[edge]]
        reachedModule[module(imports[edge])] = reached[imports[edge]]
        grew = 1
      }
    }
  }
  for (file in reached) if (file != reached[file]) print file "\t" reached[file]
}
