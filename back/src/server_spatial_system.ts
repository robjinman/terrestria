import { EntityId } from "./common/system";
import { ServerSystem } from "./common/server_system";
import { ServerSpatialComponent,
         SpatialMode } from "./server_spatial_component";
import { Span2d } from "./common/geometry";
import { GridModeImpl } from "./grid_mode_impl";
import { FreeModeImpl } from "./free_mode_impl";
import { ComponentType } from "./common/component_types";
import { GameError } from "./common/error";
import { GameEvent, GameEventType, EEntityMoved } from "./common/event";
import { Direction } from "./common/definitions";
import { SpatialComponentPacket } from "./common/spatial_component_packet";
import { ServerEntityManager } from "./server_entity_manager";
import { BLOCK_SZ } from "./common/constants";

export class ServerSpatialSystem implements ServerSystem {
  private _em: ServerEntityManager;
  private _components: Map<number, ServerSpatialComponent>;
  private _w = 0;
  private _h = 0;
  private _gravityRegion: Span2d;
  private _gridModeImpl: GridModeImpl;
  private _freeModeImpl: FreeModeImpl;

  constructor(em: ServerEntityManager,
              w: number,
              h: number,
              gravityRegion: Span2d) {
    this._em = em;
    this._components = new Map<number, ServerSpatialComponent>();
    this._gridModeImpl = new GridModeImpl(em, w, h);
    this._freeModeImpl = new FreeModeImpl();
    this._w = w;
    this._h = h;
    this._gravityRegion = gravityRegion;

    this._gridModeImpl.setComponentsMap(this._components);
    this._freeModeImpl.setComponentsMap(this._components);
  }

  getState() {
    const packets: SpatialComponentPacket[] = [];

    this._components.forEach((c, id) => {
      packets.push({
        componentType: ComponentType.SPATIAL,
        entityId: c.entityId,
        x: c.x,
        y: c.y,
        speed: c.gridMode.speed
      });
    });

    return packets;
  }

  moveAgent(id: EntityId, direction: Direction): boolean {
    const c = this.getComponent(id);
    if (c.currentMode == SpatialMode.GRID_MODE) {
      return this._gridModeImpl.moveAgent(id, direction);
    }
    else {
      return this._freeModeImpl.moveAgent(id, direction);
    }
  }

  update() {
    this._gridModeImpl.update();
    this._freeModeImpl.update();
  }

  addComponent(component: ServerSpatialComponent) {
    this._components.set(component.entityId, component);
    this._gridModeImpl.onComponentAdded(component);
    this._freeModeImpl.onComponentAdded(component);
  }

  hasComponent(id: EntityId) {
    return this._components.has(id);
  }

  getComponent(id: EntityId) {
    const c = this._components.get(id);
    if (!c) {
      throw new GameError(`No spatial component for entity ${id}`);
    }
    return c;
  }

  removeComponent(id: EntityId) {
    const c = this._components.get(id);
    if (c) {
      this._gridModeImpl.onComponentRemoved(c);
      this._freeModeImpl.onComponentRemoved(c);
    }
    this._components.delete(id);
  }

  numComponents() {
    return this._components.size;
  }

  handleEvent(event: GameEvent) {
    switch (event.type) {
      case GameEventType.ENTITY_MOVED: {
        const e = <EEntityMoved>event;
        this._onEntityMoved(e);
        break;
      }
    }
  }

  get width() {
    return this._w;
  }

  get height() {
    return this._h;
  }

  get grid() {
    return this._gridModeImpl.grid;
  }

  positionEntity(id: EntityId, x: number, y: number) {
    const c = this.getComponent(id);
    c.setStaticPos(x, y);
  }

  moveEntity(id: EntityId, dx: number, dy: number) {
    const c = this.getComponent(id);
    this.positionEntity(id, c.x + dx, c.y + dy);
  }

  getDirties() {
    const dirties: SpatialComponentPacket[] = [];

    this._components.forEach((c, id) => {
      if (c.isDirty()) {
        dirties.push({
          entityId: c.entityId,
          componentType: ComponentType.SPATIAL,
          x: c.x,
          y: c.y,
          speed: c.gridMode.speed
        });
        c.setClean();
      }
    });

    return dirties;
  }

  gridMode(entityId: EntityId): boolean {
    const c = this.getComponent(entityId);
    return c.currentMode == SpatialMode.GRID_MODE;
  }

  freeMode(entityId: EntityId): boolean {
    const c = this.getComponent(entityId);
    return c.currentMode == SpatialMode.FREE_MODE;
  }

  gm_entityIsMoving(id: EntityId): boolean {
    const c = this.getComponent(id);
    return c.gridMode.moving();
  }

  private _onEntityMoved(event: EEntityMoved) {
    const c = this.getComponent(event.entityId);
    const gridX = Math.floor(event.x / BLOCK_SZ);
    const gridY = Math.floor(event.y / BLOCK_SZ);

    if (this._gravityRegion.contains(gridX, gridY)) {
      c.currentMode == SpatialMode.FREE_MODE;
    }
    else {
      c.currentMode = SpatialMode.GRID_MODE;
    }
  }
}
