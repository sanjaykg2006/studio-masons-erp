import { notFound } from "next/navigation";

import { getDepartmentPeopleData } from "@/modules/departments/people-data";
import { PeopleAccessView } from "@/modules/departments/components/people-access-view";

/** The one screen to run a department's people, roles and abilities. */
export default async function DepartmentPeoplePage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const data = await getDepartmentPeopleData(deptId);
  if (!data) notFound();

  return (
    <PeopleAccessView
      department={data.department}
      members={data.members}
      grants={data.grants}
      people={data.people}
      roles={data.roles}
      resources={data.resources}
      subteams={data.subteams}
      subteamMembers={data.subteamMembers}
    />
  );
}
