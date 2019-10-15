import { ComponentType } from "./component_types";
import { BLOCK_SZ } from "./config";
import { ComponentPacket, Component, EntityId } from "./system";
import { Direction } from "./definitions";
import { GameError } from "./error";
import { GameEvent } from "./event";
import { EntityManager } from "./entity_manager";
import { inRange, addSetToSet } from "./utils";

export function directionToVector(dir: Direction) {
  switch (dir) {
    case Direction.UP: return [0, BLOCK_SZ];
    case Direction.RIGHT: return [BLOCK_SZ, 0];
    case Direction.DOWN: return [0, -BLOCK_SZ];
    case Direction.LEFT: return [-BLOCK_SZ, 0];
    default: return [0, 0];
  }
}

export type Vec2 = {
  x: number;
  y: number;
};

export function normalise(v: Vec2) {
  const s = Math.sqrt(v.x * v.x + v.y * v.y);
  if (s !== 0) {
    v.x /= s;
    v.y /= s;
  }
  else {
    v.x = 0.70710678118;
    v.y = 0.70710678118;
  }
}

export interface SpatialComponentPacket extends ComponentPacket {
  x: number;
  y: number;
  destX: number;
  destY: number;
  speed: number;
}

export interface PhysicalProperties {
  // If it blocks other objects (except agents) from occupying the same space
  solid: boolean;
  // If it blocks agents from occupying the same space
  blocking: boolean;
  // If it falls due to gravity (when there's no solid object supporting it)
  heavy: boolean;
  // If an agent can move it
  movable: boolean;
  // If a playable agent
  isAgent: boolean;
  // If other items can be stacked on top without rolling off
  stackable: boolean;
}

export class SpatialComponent extends Component {
  dirty = true;
  falling = false;

  private _posX: number = 0;
  private _posY: number = 0;
  private _speed: number = 0; // Pixels per second
  private _destX: number = 0;
  private _destY: number = 0;

  private _solid: boolean;
  private _blocking: boolean;
  private _stackable: boolean;
  private _heavy: boolean;
  private _movable: boolean;
  private _isAgent: boolean;

  constructor(entityId: EntityId, properties: PhysicalProperties) {
    super(entityId, ComponentType.SPATIAL);

    this._solid = properties.solid;
    this._blocking = properties.blocking;
    this._stackable = properties.stackable;
    this._heavy = properties.heavy;
    this._movable = properties.movable;
    this._isAgent = properties.isAgent;
  }

  moving() {
    return this._speed > 0.1;
  }

  get x() {
    return this._posX;
  }

  get y() {
    return this._posY;
  }

  updatePos(x: number, y: number) {
    this._posX = x;
    this._posY = y;
  }

  setPos(grid: Grid, x: number, y: number) {
    const oldDestX = this._destX;
    const oldDestY = this._destY;

    this._posX = x;
    this._posY = y;
    this._destX = x;
    this._destY = y;
    this._speed = 0;

    if (oldDestX != x || oldDestY != y) {
      this.dirty = true;
      grid.onItemMoved(this, oldDestX, oldDestY, this._destX, this._destY);
    }
  }

  get speed() {
    return this._speed;
  }

  setDestination(grid: Grid,
                 destX: number,
                 destY: number,
                 speed: number) {

    const oldDestX = this._destX;
    const oldDestY = this._destY;

    this._destX = destX;
    this._destY = destY;
    this._speed = speed;
    this.dirty = true;

    grid.onItemMoved(this, oldDestX, oldDestY, this._destX, this._destY);
  }

  get destX() {
    return this._destX;
  }

  get destY() {
    return this._destY;
  }
  
  get solid() {
    return this._solid;
  }

  get blocking() {
    return this._blocking;
  }

  get stackable() {
    return this._stackable;
  }

  get heavy() {
    return this._heavy;
  }

  get movable() {
    return this._movable;
  }

  get isAgent() {
    return this._isAgent;
  }
}

export class Grid {
  _blockW: number;
  _blockH: number;
  _w: number;
  _h: number;
  _grid: Set<SpatialComponent>[][];

  constructor(blockW: number,
              blockH: number,
              numBlocksX: number,
              numBlocksY: number) {
    this._blockW = blockW;
    this._blockH = blockH;
    this._w = numBlocksX;
    this._h = numBlocksY;
    this._grid = (new Array(numBlocksX));
    for (let col = 0; col < this._w; ++col) {
      this._grid[col] = (new Array(this._h));
      for (let row = 0; row < this._h; ++row) {
        this._grid[col][row] = new Set<SpatialComponent>();
      }
    }
  }

  toGridX(x: number, w: number = this._blockW) {
    return Math.floor((x + 0.5 * w) / this._blockW);
  }

  toGridY(y: number, h: number = this._blockH) {
    return Math.floor((y + 0.5 * h) / this._blockH);
  }

  outOfRange(x: number, y: number): boolean {
    const col = this.toGridX(x);
    const row = this.toGridY(y);
    return col < 0 || col > this._w - 1 ||
           row < 0 || row > this._h - 1;
  }

  addItem(item: SpatialComponent) {
    const col = this.toGridX(item.x);
    const row = this.toGridY(item.y);
    this.inCell(col, row).add(item);
  }

  onItemMoved(item: SpatialComponent,
              oldX: number,
              oldY: number,
              newX: number,
              newY: number) {
    const oldCol = this.toGridX(oldX);
    const oldRow = this.toGridY(oldY);

    const newCol = this.toGridX(newX);
    const newRow = this.toGridY(newY);

    if (oldCol == newCol && oldRow == newRow) {
      return;
    }

    if (!this.inCell(oldCol, oldRow).delete(item)) {
      throw new GameError(`No such entity at position ${oldX}, ${oldY}`);
    }
  
    this.inCell(newCol, newRow).add(item);
  }

  removeItem(item: SpatialComponent): boolean {
    for (const col of this._grid) {
      for (const cell of col) {
        if (cell.delete(item)) {
          return true;
        }
      }
    }
 
    return false;
  }

  inCell(col: number, row: number): Set<SpatialComponent> {
    if (col < 0 || col > this._w - 1 || row < 0 || row > this._h - 1) {
      throw new GameError(`Cannot retrieve items in cell (${col}, ${row}). ` +
                          `Index out of range`);
    }
    return this._grid[col][row];
  }

  inCells(fromCol: number,
          toCol: number,
          fromRow: number,
          toRow: number): Set<SpatialComponent> {
    const items = new Set<SpatialComponent>();
    for (let c = fromCol; c <= toCol; ++c) {
      for (let r = fromRow; r <= toRow; ++r) {
        if (inRange(c, 0, this._w - 1) && inRange(r, 0, this._h - 1)) {
          addSetToSet(this.inCell(c, r), items);
        }
      }
    }
    return items;
  }

  idsInCells(fromCol: number,
             toCol: number,
             fromRow: number,
             toRow: number): EntityId[] {
    const items = this.inCells(fromCol, toCol, fromRow, toRow);
    return [...items].map(c => c.entityId);
  }

  idsInCell(col: number, row: number): EntityId[] {
    return [...this.inCell(col, row)].map(c => c.entityId);
  }

  atPos(x: number, y: number): Set<SpatialComponent> {
    const col = this.toGridX(x);
    const row = this.toGridY(y);
    return this.inCell(col, row);
  }

  idsAtPos(x: number, y: number): EntityId[] {
    return [...this.atPos(x, y)].map(c => c.entityId);
  }

  dbg_print() {
    for (let i = 0; i < this._w; ++i) {
      let msg = "";
      for (let j = 0; j < this._h; ++j) {
        msg += this.inCell(i, j).size + " ";
      }
      console.log(msg);
    }
  }

  itemsWithPropAtPos(x: number, y: number, prop: string) {
    const allItems = this.atPos(x, y);
    const itemsWithProp = new Set<SpatialComponent>();

    for (const item of allItems) {
      const c = <any>item;
      if (c[prop]) {
        itemsWithProp.add(item);
      }
    }

    return itemsWithProp;
  }

  blockingItemsAtPos(x: number, y: number) {
    return this.itemsWithPropAtPos(x, y, "blocking");
  }

  solidItemsAtPos(x: number, y: number) {
    return this.itemsWithPropAtPos(x, y, "solid");
  }

  stackableItemsAtPos(x: number, y: number) {
    return this.itemsWithPropAtPos(x, y, "stackable");
  }

  movableItemsAtPos(x: number, y: number) {
    return this.itemsWithPropAtPos(x, y, "movable");
  }

  spaceFreeAtPos(x: number, y: number): boolean {
    return !this.outOfRange(x, y) && this.solidItemsAtPos(x, y).size === 0;
  }

  stackableSpaceAtPos(x: number, y: number): boolean {
    if (this.toGridY(y) == -1) {
      return true;
    }
    return this.stackableItemsAtPos(x, y).size > 0;
  }
}

export class SpatialSystem {
  protected em: EntityManager;
  protected components: Map<number, SpatialComponent>;
  protected w = 0;
  protected h = 0;
  protected frameRate: number;
  grid: Grid;

  constructor(em: EntityManager, w: number, h: number, frameRate: number) {
    this.em = em;
    this.components = new Map<number, SpatialComponent>();

    this.w = w;
    this.h = h;
    this.frameRate = frameRate;

    this.grid = new Grid(BLOCK_SZ, BLOCK_SZ, w, h);
  }

  update() {
    this.components.forEach(c => {
      if (c.moving()) {
        this.updateEntityPos(c);
      }
    });
  }

  positionEntity(id: EntityId, x: number, y: number) {
    const c = this.getComponent(id);
    c.setPos(this.grid, x, y);
  }
  
  entityIsMoving(id: EntityId) {
    const c = this.getComponent(id);
    return c.moving();
  }

  addComponent(component: SpatialComponent) {
    this.components.set(component.entityId, component);
    this.grid.addItem(component);
  }

  hasComponent(id: EntityId) {
    return this.components.has(id);
  }

  getComponent(id: EntityId) {
    const c = this.components.get(id);
    if (!c) {
      throw new GameError(`No spatial component for entity ${id}`);
    }
    return c;
  }

  removeComponent(id: EntityId) {
    const c = this.components.get(id);
    if (c) {
      this.grid.removeItem(c);
    }
    this.components.delete(id);
  }

  finishTween(id: EntityId) {
    const c = this.components.get(id);
    if (c) {
      this.positionEntity(id, c.destX, c.destY);
    }
  }

  numComponents() {
    return this.components.size;
  }

  handleEvent(event: GameEvent) {}

  get width() {
    return this.w;
  }

  get height() {
    return this.h;
  }

  stopEntity(id: EntityId) {
    const c = this.getComponent(id);
    c.setPos(this.grid, c.x, c.y);
  }

  moveEntity(id: EntityId, dx: number, dy: number) {
    const c = this.getComponent(id);
    this.positionEntity(id, c.x + dx, c.y + dy);
  }

  positionEntity_tween(id: EntityId, x: number, y: number, t: number): boolean {
    const c = this.getComponent(id);
    if (!c.moving()) {
      const dx = x - c.x;
      const dy = y - c.y;
      const s = Math.sqrt(dx * dx + dy * dy);
      c.setDestination(this.grid, x, y, s / t);
      return true;
    }
    return false;
  }

  moveEntity_tween(id: EntityId, dx: number, dy: number, t: number): boolean {
    const c = this.getComponent(id);
    return this.positionEntity_tween(id, c.x + dx, c.y + dy, t);
  }

  getDirties() {
    const dirties: SpatialComponentPacket[] = [];

    this.components.forEach((c, id) => {
      if (c.dirty) {
        dirties.push({
          entityId: c.entityId,
          componentType: ComponentType.SPATIAL,
          x: c.x,
          y: c.y,
          speed: c.speed,
          destX: c.destX,
          destY: c.destY
        });
        c.dirty = false;
      }
    });

    return dirties;
  }

  protected updateEntityPos(c: SpatialComponent) {
    const v: Vec2 = {
      x: c.destX - c.x,
      y: c.destY - c.y
    };
    normalise(v);

    const dx = v.x * c.speed / this.frameRate;
    const dy = v.y * c.speed / this.frameRate;

    c.updatePos(c.x + dx, c.y + dy);

    const xDir = dx < 0 ? -1 : 1;
    const yDir = dy < 0 ? -1 : 1;
    const reachedDestX = xDir * (c.x - c.destX) > -0.5;
    const reachedDestY = yDir * (c.y - c.destY) > -0.5;

    if (reachedDestX && reachedDestY) { 
      c.setPos(this.grid, c.destX, c.destY);
    }
  }
}
