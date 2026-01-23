/**
 * Manufacturing module types
 */

export enum ProductionDelayReason {
  MATERIAL_SHORTAGE = 'Material Shortage',
  CAPACITY_ISSUE = 'Capacity Issue',
  QUALITY_FAIL = 'Quality Failure',
  LOGISTICS_DELAY = 'Logistics Delay',
  OTHER = 'Other'
}

export interface ProductionUpdate {
  id: string;
  projectId: string;
  previousEtd?: string;
  newEtd: string;
  isOnTime: boolean;
  delayReason?: ProductionDelayReason;
  notes?: string;
  updatedBy?: string;
  isSupplierUpdate: boolean;
  createdAt: string;
}
