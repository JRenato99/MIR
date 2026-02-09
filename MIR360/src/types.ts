export type ViewMode = "overview" | "route";

export type RouteSummary = {
  id?: string;
  from_odf_id?: string;
  to_odf_id?: string;
  path_text?:string
  span_list?:string;
};

export type SelectedNode = {  
  id: string;
  kind?: string;
  label?: string;
  layer?: string | null;
  status?: string | null;
  group?: string;
  meta?: Record<string, unknown> | null;
};

export type SelectedEdge = {
  id: string;
  edge_kind?: string;
  from?: string;
  to?: string;
  title?: string;
  meta?: Record<string, unknown> | null;
};

export type SelectionPayload = {
  node?: SelectedNode | null;
  edge?: SelectedEdge | null;
  pinned?: { type: "node" | "edge"; id: string } | null;
};