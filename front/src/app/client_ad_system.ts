import { EntityId, Component } from "./common/system";
import { GameError } from "./common/error";
import { GameEvent } from "./common/event";
import { ClientSystem } from "./common/client_system";
import { ComponentType } from "./common/component_types";
import { AdComponentPacket } from "./common/ad_component_packet";
import { EntityManager } from "./common/entity_manager";
import { RenderSystem } from "./render_system";
import { Scheduler } from "./scheduler";

export class ClientAdComponent extends Component {
  adName: string|null = null;

  constructor(entityId: EntityId) {
    super(entityId, ComponentType.AD);
  }
}

export class ClientAdSystem implements ClientSystem {
  private _em: EntityManager;
  private _scheduler: Scheduler;
  private _components: Map<number, ClientAdComponent>;
  private _placeholders = new Map<string, string>();

  constructor(em: EntityManager, scheduler: Scheduler) {
    this._em = em;
    this._scheduler = scheduler;
    this._components = new Map<number, ClientAdComponent>();
  }

  addPlaceholder(adName: string, imageName: string) {
    this._placeholders.set(adName, imageName);
  }

  updateComponent(packet: AdComponentPacket) {
    const c = this.getComponent(packet.entityId);
    c.adName = packet.adName;

    if (c.adName) {
      const placeHolder = this._placeholders.get(c.adName);
      if (packet.adUrl) {
        this._addImageToRenderSystem(c.adName, packet.adUrl).then(() => {
          this._scheduler.addFunction(() => {
            if (c.adName) {
              this._setImageForEntity(c.entityId, c.adName);
            }
          }, 0);
        });
      }
      else {
        if (placeHolder) {
          this._setImageForEntity(c.entityId, placeHolder);
        }
      }
    }
  }

  update() {}

  addComponent(component: ClientAdComponent) {
    this._components.set(component.entityId, component);
  }

  hasComponent(id: EntityId) {
    return this._components.has(id);
  }

  getComponent(id: EntityId) {
    const c = this._components.get(id);
    if (!c) {
      throw new GameError(`No ad component for entity ${id}`);
    }
    return c;
  }

  removeComponent(id: EntityId) {
    this._components.delete(id);
  }

  numComponents() {
    return this._components.size;
  }

  handleEvent(event: GameEvent) {}

  private async _addImageToRenderSystem(imageName: string, imageUrl: string) {
    const renderSys = <RenderSystem>this._em.getSystem(ComponentType.RENDER);
    await renderSys.addImage(imageName, imageUrl);
  }

  private _setImageForEntity(entityId: EntityId, imageName: string) {
    const renderSys = <RenderSystem>this._em.getSystem(ComponentType.RENDER);
    renderSys.addStaticImage(entityId, { name: imageName });
    renderSys.setCurrentImage(entityId, imageName);
  }
}
