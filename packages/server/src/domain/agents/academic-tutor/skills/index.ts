export { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
export { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
export { RememberTheStudentSkill } from "./remember-the-student.ts";
export { DebateWithTheStudentSkill } from "./debate-with-the-student.ts";

import { UseUploadedMaterialsSkill } from "./use-uploaded-materials.ts";
import { CreateStudyArtifactsSkill } from "./create-study-artifacts.ts";
import { RememberTheStudentSkill } from "./remember-the-student.ts";
import { DebateWithTheStudentSkill } from "./debate-with-the-student.ts";

export const AcademicTutorSkills = [
  UseUploadedMaterialsSkill,
  CreateStudyArtifactsSkill,
  RememberTheStudentSkill,
  DebateWithTheStudentSkill
] as const;
