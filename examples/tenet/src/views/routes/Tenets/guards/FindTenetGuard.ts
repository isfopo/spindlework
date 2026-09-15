import type { Context } from "hono";
import type { IExistable } from "spindlework/thread";
import { tenetsRepo } from "domains/tenet/repo";

export class FindTenetGuard implements IExistable {
  key = "tenet";

  async load(c: Context): Promise<unknown> {
    return tenetsRepo((c.env as CloudflareBindings).DB).findOneBy({
      slug: c.req.param("slug")!,
    });
  }
}

