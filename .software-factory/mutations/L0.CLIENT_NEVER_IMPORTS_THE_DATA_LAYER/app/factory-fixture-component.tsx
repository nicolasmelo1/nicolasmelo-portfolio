import { POST } from "@/app/api/chat/route";

export async function UsageTable() {
  const rows = await POST(new Request("http://local/api/chat"));
  return <table>{rows.status}</table>;
}
