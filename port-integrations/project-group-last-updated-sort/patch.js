"use strict";

const currentGroupSorter =
  "function von({groups:e,projectOrder:t}){return sin(e,t)}";
const patchedGroupSorter =
  "function von({groups:e,projectOrder:t,items:n,sortMode:r}){if(r!==`updated_at`)return sin(e,t);let i=new Map;for(let e of n??[]){let t=e.task?.key;t!=null&&i.set(t,Math.max(i.get(t)??0,e.recencyAt??0))}return e.map((e,t)=>({group:e,index:t,recencyAt:(e.threadKeys??[]).reduce((e,t)=>Math.max(e,i.get(t)??0),e.projectUpdatedAt??0)})).sort((e,t)=>t.recencyAt-e.recencyAt||e.index-t.index).map(({group:e})=>e)}";

const currentGroupSorterCall =
  "M=von({groups:k,projectOrder:im(t,tu.PROJECT_ORDER)})";
const patchedGroupSorterCall =
  "M=von({groups:k,projectOrder:im(t,tu.PROJECT_ORDER),items:f,sortMode:j})";

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyProjectGroupLastUpdatedSortPatch(source) {
  const currentSorterCount = countOccurrences(source, currentGroupSorter);
  const patchedSorterCount = countOccurrences(source, patchedGroupSorter);
  const currentCallCount = countOccurrences(source, currentGroupSorterCall);
  const patchedCallCount = countOccurrences(source, patchedGroupSorterCall);

  if (
    patchedSorterCount === 1 &&
    patchedCallCount === 1 &&
    currentSorterCount === 0 &&
    currentCallCount === 0
  ) {
    return source;
  }

  if (
    currentSorterCount !== 1 ||
    patchedSorterCount !== 0 ||
    currentCallCount !== 1 ||
    patchedCallCount !== 0
  ) {
    console.warn(
      "WARN: Could not find current project group sorting insertion points - skipping project group Last updated sort feature patch",
    );
    return source;
  }

  return source
    .replace(currentGroupSorter, patchedGroupSorter)
    .replace(currentGroupSorterCall, patchedGroupSorterCall);
}

const descriptors = [
  {
    id: "last-updated-project-groups",
    phase: "webview-asset",
    order: 20_900,
    ciPolicy: "optional",
    pattern: /^app-initial-[A-Za-z0-9_-]+\.js$/,
    missingDescription: "project group sort webview bundle",
    skipDescription: "project group Last updated sorting feature patch",
    apply: applyProjectGroupLastUpdatedSortPatch,
  },
];

module.exports = {
  applyProjectGroupLastUpdatedSortPatch,
  descriptors,
};
