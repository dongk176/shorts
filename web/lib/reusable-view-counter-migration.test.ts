import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202609030001_reusable_view_counter.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("reusable view counter bootstrap migration", () => {
  it("deduplicates both reusable histories and seeds an atomic schedule", () => {
    expect(migration).toContain("shorts_mvp.popular_search_items");
    expect(migration).toContain("shorts_mvp.popular_video_items");
    expect(migration.match(/item\.license='creativeCommon'/g)).toHaveLength(2);
    expect(migration).toContain("partition by video_id");
    expect(migration).toContain("reusable_views_start");
    expect(migration).toContain("reusable_views_target");
    expect(migration).toContain("reusable_views_started_at_ms");
    expect(migration).toContain("reusable_views_ends_at_ms");
    expect(migration).toContain("on conflict (key) do nothing");
  });
});
