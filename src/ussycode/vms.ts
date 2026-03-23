import { ussycodeInternalGet } from "./client";

export interface UssycodeVMNode {
  id: string;
  name: string;
}

export interface UssycodeVM {
  id: number;
  name: string;
  status: "creating" | "running" | "stopped" | "error";
  image: string;
  vcpu: number;
  memory_mb: number;
  disk_gb: number;
  ip_address: string | null;
  public_url: string;
  node: UssycodeVMNode | null;
  created_at: string;
  updated_at: string;
}

export class UssycodeVMListError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string
  ) {
    super(message);
  }
}

export async function listUssycodeVMsByHandle(
  handle: string
): Promise<UssycodeVM[]> {
  console.log("[ussycode.vms] listing", { handle });

  const resp = await ussycodeInternalGet("/internal/vms", { handle });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("[ussycode.vms] failed", {
      handle,
      status: resp.status,
      body,
    });
    throw new UssycodeVMListError(
      `ussycode VM list failed: ${resp.status} ${body}`,
      resp.status,
      body
    );
  }

  const payload = (await resp.json()) as {
    vms: Array<
      Omit<UssycodeVM, "ip_address" | "node"> & {
        ip_address?: string | null;
        node?: UssycodeVMNode | null;
      }
    >;
  };
  const vms: UssycodeVM[] = payload.vms.map((vm) => ({
    ...vm,
    ip_address: vm.ip_address ?? null,
    node: vm.node ?? null,
  }));

  console.log("[ussycode.vms] success", { handle, count: vms.length });
  return vms;
}