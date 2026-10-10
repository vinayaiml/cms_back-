-- Add robot/user-aware LMS access controls for manifest filtering.
CREATE TABLE "RobotCourseAccess" (
  "id" SERIAL NOT NULL,
  "robotId" INTEGER NOT NULL,
  "courseId" INTEGER NOT NULL,
  "accessType" "CourseAccessType" NOT NULL DEFAULT 'FULL_COURSE',
  "levelId" INTEGER,
  "chapterId" INTEGER,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RobotCourseAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserCourseAccess" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "courseId" INTEGER NOT NULL,
  "accessType" "CourseAccessType" NOT NULL DEFAULT 'FULL_COURSE',
  "levelId" INTEGER,
  "chapterId" INTEGER,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserCourseAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RobotCourseAccess_robotId_courseId_accessType_levelId_chapterId_key"
  ON "RobotCourseAccess"("robotId", "courseId", "accessType", "levelId", "chapterId");
CREATE INDEX "RobotCourseAccess_robotId_idx" ON "RobotCourseAccess"("robotId");
CREATE INDEX "RobotCourseAccess_courseId_idx" ON "RobotCourseAccess"("courseId");

CREATE UNIQUE INDEX "UserCourseAccess_userId_courseId_accessType_levelId_chapterId_key"
  ON "UserCourseAccess"("userId", "courseId", "accessType", "levelId", "chapterId");
CREATE INDEX "UserCourseAccess_userId_idx" ON "UserCourseAccess"("userId");
CREATE INDEX "UserCourseAccess_courseId_idx" ON "UserCourseAccess"("courseId");

ALTER TABLE "RobotCourseAccess"
  ADD CONSTRAINT "RobotCourseAccess_robotId_fkey"
  FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RobotCourseAccess"
  ADD CONSTRAINT "RobotCourseAccess_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCourseAccess"
  ADD CONSTRAINT "UserCourseAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCourseAccess"
  ADD CONSTRAINT "UserCourseAccess_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
