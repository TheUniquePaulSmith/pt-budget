"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { Category, Project, Trip } from '../types/database';

export interface DatabaseCategorySlice {
  addCategory: (
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
}

export interface DatabaseCompanySlice {
  addCompany: (name: string) => Promise<number>;
}

export interface DatabaseProjectSlice {
  addProject: (
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  updateProject: (
    id: number,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
}

export interface DatabaseTripSlice {
  addTrip: (
    trip: Omit<Trip, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  updateTrip: (
    id: number,
    updates: Partial<Omit<Trip, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteTrip: (id: number) => Promise<void>;
}

type CatalogAndPlanningService = Pick<
  DatabaseService,
  | 'addCategory'
  | 'addCompany'
  | 'addProject'
  | 'updateProject'
  | 'deleteProject'
  | 'addTrip'
  | 'updateTrip'
  | 'deleteTrip'
>;

interface UseDatabaseCatalogAndPlanningSlicesOptions {
  databaseService: CatalogAndPlanningService | null;
  refreshCategories: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshTrips: () => Promise<void>;
}

export function useDatabaseCatalogAndPlanningSlices({
  databaseService,
  refreshCategories,
  refreshCompanies,
  refreshProjects,
  refreshTrips,
}: UseDatabaseCatalogAndPlanningSlicesOptions): {
  categoriesSlice: DatabaseCategorySlice;
  companiesSlice: DatabaseCompanySlice;
  projectsSlice: DatabaseProjectSlice;
  tripsSlice: DatabaseTripSlice;
} {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const addCategory = useCallback(
    async (
      category: Omit<Category, "id" | "created_at" | "updated_at">
    ): Promise<number> => {
      const id = await requireService().addCategory(category);
      await refreshCategories();
      return id;
    },
    [refreshCategories, requireService]
  );

  const addCompany = useCallback(
    async (name: string): Promise<number> => {
      const id = await requireService().addCompany(name);
      await refreshCompanies();
      return id;
    },
    [refreshCompanies, requireService]
  );

  const addProject = useCallback(
    async (
      project: Omit<Project, "id" | "created_at" | "updated_at">
    ): Promise<number> => {
      const id = await requireService().addProject(project);
      await refreshProjects();
      return id;
    },
    [refreshProjects, requireService]
  );

  const updateProject = useCallback(
    async (
      id: number,
      updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
    ): Promise<void> => {
      await requireService().updateProject(id, updates);
      await refreshProjects();
    },
    [refreshProjects, requireService]
  );

  const deleteProject = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteProject(id);
      await refreshProjects();
    },
    [refreshProjects, requireService]
  );

  const addTrip = useCallback(
    async (
      trip: Omit<Trip, "id" | "created_at" | "updated_at">
    ): Promise<number> => {
      const id = await requireService().addTrip(trip);
      await refreshTrips();
      return id;
    },
    [refreshTrips, requireService]
  );

  const updateTrip = useCallback(
    async (
      id: number,
      updates: Partial<Omit<Trip, "id" | "created_at" | "updated_at">>
    ): Promise<void> => {
      await requireService().updateTrip(id, updates);
      await refreshTrips();
    },
    [refreshTrips, requireService]
  );

  const deleteTrip = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteTrip(id);
      await refreshTrips();
    },
    [refreshTrips, requireService]
  );

  const categoriesSlice = useMemo(
    () => ({
      addCategory,
    }),
    [addCategory]
  );

  const companiesSlice = useMemo(
    () => ({
      addCompany,
    }),
    [addCompany]
  );

  const projectsSlice = useMemo(
    () => ({
      addProject,
      updateProject,
      deleteProject,
    }),
    [addProject, updateProject, deleteProject]
  );

  const tripsSlice = useMemo(
    () => ({
      addTrip,
      updateTrip,
      deleteTrip,
    }),
    [addTrip, updateTrip, deleteTrip]
  );

  return {
    categoriesSlice,
    companiesSlice,
    projectsSlice,
    tripsSlice,
  };
}