/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Link } from '@tanstack/react-router';
import { BarChart3, Clock3 } from 'lucide-react';
import type { DisplayCourse } from '../lib/course-display';
import { CourseThumbnail } from './course-thumbnail';

/**
 * A course in a grid of courses: its thumbnail, category, duration, title,
 * description and level, linking to its page. Shared by the catalogue on the
 * home page and the search results, so a course looks the same in both.
 */
export function CourseCard({ course }: { course: DisplayCourse }) {
  return (
    <Card className="group overflow-hidden pt-0 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
      <CourseThumbnail
        course={course}
        iconClassName="transition-transform group-hover:scale-110"
      />
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-primary">{course.category}</p>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" /> {course.duration}
          </span>
        </div>
        <CardTitle className="mt-2">{course.title}</CardTitle>
        <CardDescription className="leading-6">
          {course.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex items-center justify-between border-t pt-5">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BarChart3 className="size-4" /> {course.level}
        </span>
        <Button variant="ghost" size="sm" asChild>
          <Link
            to="/learn/$courseId"
            params={{ courseId: course.courseId }}
            aria-label={`Preview ${course.title}`}
          >
            Learn more
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
