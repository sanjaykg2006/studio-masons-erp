import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/core/rbac/can";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getFolderAccessConfig, getStageSteps } from "@/modules/design/data";
import { FolderAccessMatrix } from "@/modules/design/components/folder-access-matrix";
import { StageStepsEditor } from "@/modules/design/components/stage-steps-editor";

/** Design configuration: folder access matrix + the stage progress checklist. */
export default async function DesignSettingsPage() {
  await requirePermission("design.folder", "manage");

  const [config, steps] = await Promise.all([
    getFolderAccessConfig(),
    getStageSteps(),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/design"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Design Department
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Design settings</h1>
        <p className="text-muted-foreground text-sm">
          These rules apply to every design project. Changes take effect immediately.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Controlled folder access</CardTitle>
          <CardDescription>
            Who can do what in each of the 12 standard project folders, by design role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FolderAccessMatrix
            folders={config.folders}
            roles={config.roles}
            access={config.access}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage checklist</CardTitle>
          <CardDescription>
            The steps that fill each project&apos;s progress bars. Add, rename or
            remove steps per stage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StageStepsEditor steps={steps} />
        </CardContent>
      </Card>
    </div>
  );
}
