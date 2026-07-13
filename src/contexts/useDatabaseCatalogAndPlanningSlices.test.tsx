// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Category, Project } from '../types/database';
import { useDatabaseCatalogAndPlanningSlices } from './useDatabaseCatalogAndPlanningSlices';

type CategoryInput = Omit<Category, 'id' | 'created_at' | 'updated_at'>;
type ProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at'>;

function createServiceMock() {
  return {
    addCategory: vi.fn().mockResolvedValue(3),
    addCompany: vi.fn().mockResolvedValue(5),
    updateCompany: vi.fn().mockResolvedValue(undefined),
    addProject: vi.fn().mockResolvedValue(8),
    updateProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    addTrip: vi.fn().mockResolvedValue(11),
    updateTrip: vi.fn().mockResolvedValue(undefined),
    deleteTrip: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useDatabaseCatalogAndPlanningSlices', () => {
  it('throws when catalog mutations run without an initialized service', async () => {
    const refreshCategories = vi.fn().mockResolvedValue(undefined);
    const refreshCompanies = vi.fn().mockResolvedValue(undefined);
    const refreshProjects = vi.fn().mockResolvedValue(undefined);
    const refreshTrips = vi.fn().mockResolvedValue(undefined);
    const category: CategoryInput = {
      name: 'Food',
      type: 'expense',
      color: '#112233',
      icon: 'restaurant',
      is_system: false,
    } as CategoryInput;

    const { result } = renderHook(() =>
      useDatabaseCatalogAndPlanningSlices({
        databaseService: null,
        refreshCategories,
        refreshCompanies,
        refreshProjects,
        refreshTrips,
      })
    );

    await expect(result.current.categoriesSlice.addCategory(category)).rejects.toThrow(
      'Database service not initialized'
    );
    expect(refreshCategories).not.toHaveBeenCalled();
  });

  it('refreshes cached companies after adding a company', async () => {
    const refreshCategories = vi.fn().mockResolvedValue(undefined);
    const refreshCompanies = vi.fn().mockResolvedValue(undefined);
    const refreshProjects = vi.fn().mockResolvedValue(undefined);
    const refreshTrips = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseCatalogAndPlanningSlices({
        databaseService: service,
        refreshCategories,
        refreshCompanies,
        refreshProjects,
        refreshTrips,
      })
    );

    let companyId = 0;
    await act(async () => {
      companyId = await result.current.companiesSlice.addCompany('Acme Supply');
    });

    expect(service.addCompany).toHaveBeenCalledWith('Acme Supply');
    expect(refreshCompanies).toHaveBeenCalledTimes(1);
    expect(companyId).toBe(5);
  });

  it('refreshes cached projects after updating a project', async () => {
    const refreshCategories = vi.fn().mockResolvedValue(undefined);
    const refreshCompanies = vi.fn().mockResolvedValue(undefined);
    const refreshProjects = vi.fn().mockResolvedValue(undefined);
    const refreshTrips = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();
    const updates: Partial<ProjectInput> = {
      name: 'Kitchen Remodel Phase 2',
      estimated_cost: 12000,
    };

    const { result } = renderHook(() =>
      useDatabaseCatalogAndPlanningSlices({
        databaseService: service,
        refreshCategories,
        refreshCompanies,
        refreshProjects,
        refreshTrips,
      })
    );

    await act(async () => {
      await result.current.projectsSlice.updateProject(8, updates);
    });

    expect(service.updateProject).toHaveBeenCalledWith(8, updates);
    expect(refreshProjects).toHaveBeenCalledTimes(1);
    expect(refreshTrips).not.toHaveBeenCalled();
  });

  it('refreshes cached trips after deleting a trip', async () => {
    const refreshCategories = vi.fn().mockResolvedValue(undefined);
    const refreshCompanies = vi.fn().mockResolvedValue(undefined);
    const refreshProjects = vi.fn().mockResolvedValue(undefined);
    const refreshTrips = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseCatalogAndPlanningSlices({
        databaseService: service,
        refreshCategories,
        refreshCompanies,
        refreshProjects,
        refreshTrips,
      })
    );

    await act(async () => {
      await result.current.tripsSlice.deleteTrip(11);
    });

    expect(service.deleteTrip).toHaveBeenCalledWith(11);
    expect(refreshTrips).toHaveBeenCalledTimes(1);
    expect(refreshProjects).not.toHaveBeenCalled();
  });
});