"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Boxes, Package } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  Asset,
  AssetCategoryTotal,
  ConsumptionEntry,
  MaterialStock,
  PickerOption,
} from "@/modules/inventory/types";
import { MaterialTracker } from "@/modules/inventory/components/material-tracker";
import { AssetRegistry } from "@/modules/inventory/components/asset-registry";

type Tab = "material" | "assets";

export function InventoryView({
  projectId,
  projectName,
  stock,
  consumption,
  canRecord,
  canManageStock,
  assets,
  assetTotals,
  projects,
  people,
  canSeeAssets,
  canCreateAsset,
  canManageAsset,
  canDeleteAsset,
}: {
  projectId: string;
  projectName: string;
  stock: MaterialStock[];
  consumption: ConsumptionEntry[];
  canRecord: boolean;
  canManageStock: boolean;
  assets: Asset[];
  assetTotals: AssetCategoryTotal[];
  projects: PickerOption[];
  people: PickerOption[];
  canSeeAssets: boolean;
  canCreateAsset: boolean;
  canManageAsset: boolean;
  canDeleteAsset: boolean;
}) {
  const [tab, setTab] = useState<Tab>("material");

  const tabs: { id: Tab; label: string; icon: typeof Package }[] = [
    { id: "material", label: "Project material", icon: Package },
    ...(canSeeAssets ? [{ id: "assets" as Tab, label: "Company assets", icon: Boxes }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-muted-foreground">
          What this project has received and consumed, and the company assets in use.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                tab === t.id
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              <Icon className="size-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "material" && (
        <MaterialTracker
          projectId={projectId}
          stock={stock}
          consumption={consumption}
          canRecord={canRecord}
          canManage={canManageStock}
        />
      )}

      {tab === "assets" && canSeeAssets && (
        <AssetRegistry
          assets={assets}
          totals={assetTotals}
          projects={projects}
          people={people}
          canCreate={canCreateAsset}
          canManage={canManageAsset}
          canDelete={canDeleteAsset}
        />
      )}
    </div>
  );
}
