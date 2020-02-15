import { EntityId } from "./common/system";
import { ServerSystem } from "./common/server_system";
import { ServerSpatialComponent } from "./server_spatial_component";
import { Span2d } from "./common/span";
import { GridModeImpl } from "./grid_mode_impl";
import { FreeModeImpl } from "./free_mode_impl";
import { ComponentType } from "./common/component_types";
import { GameError } from "./common/error";
import { GameEvent } from "./common/event";
import { Direction } from "./common/definitions";
import { SpatialComponentPacket,
         SpatialMode } from "./common/spatial_component_packet";
import { ServerEntityManager } from "./server_entity_manager";
import { EntityManager } from "./common/entity_manager";
import { directionToVector } from "./common/geometry";
import { Logger } from "./logger";

export class ServerSpatialSystem implements ServerSystem {
  private _em: EntityManager;
  private _components: Map<EntityId, ServerSpatialComponent>;
  private _w = 0;
  private _h = 0;
  private _gridModeImpl: GridModeImpl;
  private _freeModeImpl: FreeModeImpl;

  constructor(em: ServerEntityManager,
              w: number,
              h: number,
              gravityRegion: Span2d,
              logger: Logger) {

    const attemptTransitionFn = this._attemptModeTransition.bind(this);

    this._em = em;
    this._components = new Map<EntityId, ServerSpatialComponent>();
    this._gridModeImpl = new GridModeImpl(em,
                                          w,
                                          h,
                                          gravityRegion,
                                          attemptTransitionFn,
                                          logger);
    this._freeModeImpl = new FreeModeImpl(gravityRegion,
                                          attemptTransitionFn);
    this._w = w;
    this._h = h;
  }

  getState() {
    const packets: SpatialComponentPacket[] = [];

    this._components.forEach((c, id) => {
      packets.push({
        componentType: ComponentType.SPATIAL,
        entityId: c.entityId,
        mode: c.currentMode,
        x: c.x,
        y: c.y,
        // Ignore angle if fixed. Workaround for
        // https://github.com/liabru/matter-js/issues/800
        angle: c.freeMode.fixedAngle ? 0 : c.freeMode.angle,
        speed: 0
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

    const x = component.x;
    const y = component.y;

    if (component.currentMode == SpatialMode.GRID_MODE) {
      this._gridModeImpl.addComponent(component.gridMode, x, y);
    }
    else if (component.currentMode == SpatialMode.FREE_MODE) {
      this._freeModeImpl.addComponent(component.freeMode, x, y);
    }
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
      this._gridModeImpl.removeComponent(c.gridMode);
      this._freeModeImpl.removeComponent(c.freeMode);
    }
    this._components.delete(id);
  }

  numComponents() {
    return this._components.size;
  }

  handleEvent(event: GameEvent) {}

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
        if (c.currentMode == SpatialMode.GRID_MODE) {
          dirties.push({
            entityId: c.entityId,
            componentType: ComponentType.SPATIAL,
            mode: c.currentMode,
            x: c.x,
            y: c.y,
            angle: 0,
            speed: c.gridMode.speed
          });
        }
        else if (c.currentMode == SpatialMode.FREE_MODE) {
          dirties.push({
            entityId: c.entityId,
            componentType: ComponentType.SPATIAL,
            mode: c.currentMode,
            x: c.x,
            y: c.y,
            // Ignore angle if fixed. Workaround for
            // https://github.com/liabru/matter-js/issues/800
            angle: c.freeMode.fixedAngle ? 0 : c.freeMode.angle,
            speed: 0
          });
        }
        c.setClean();
      }
    });

    return dirties;
  }

  gm_entityIsMoving(id: EntityId): boolean {
    const c = this.getComponent(id);
    return c.gridMode.moving();
  }

  private _doModeTransition(c: ServerSpatialComponent,
                            x: number,
                            y: number,
                            direction: Direction): boolean {
    const initMode = c.currentMode;

    if (c.currentMode == SpatialMode.GRID_MODE) {
      c.currentMode = SpatialMode.FREE_MODE;

      if (this._freeModeImpl.addComponent(c.freeMode, x, y, direction)) {
        this._gridModeImpl.removeComponent(c.gridMode);
        return true;
      }
    }
    else if (c.currentMode == SpatialMode.FREE_MODE) {
      c.currentMode = SpatialMode.GRID_MODE;

      if (this._gridModeImpl.addComponent(c.gridMode, x, y, direction)) {
        this._freeModeImpl.removeComponent(c.freeMode);
        return true;
      }
    }

    c.currentMode = initMode;
    return false;
  }

  private _attemptModeTransition(entityId: EntityId,
                                 direction: Direction): boolean {
    const c = this.getComponent(entityId);

    const v = directionToVector(direction);
    const destX = c.x + v.x;
    const destY = c.y + v.y;

    return this._doModeTransition(c, destX, destY, direction);
  }
}
