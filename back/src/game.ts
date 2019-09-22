import _ from "underscore";
import { PlayerAction } from "./common/action";
import { constructSoil, constructRock, constructGem,
         constructPlayer } from "./factory";
import { EntityManager, EntityId } from "./common/entity_manager";
import { SpatialSystem } from "./common/spatial_system";
import { AgentSystem } from "./common/agent_system";
import { ComponentType } from "./common/component_types";
import { Pipe } from "./pipe";
import { GameResponseType, RGameState, RNewEntity } from "./common/response";
import { GameLogic } from "./game_logic";
import { EntityType } from "./common/game_objects";
import { WORLD_W, WORLD_H, BLOCK_SZ } from "./common/config";

const FRAME_DURATION_MS = 100;

function noThrow(fn: () => any) {
  try {
    return fn();
  }
  catch (err) {
    console.error("Error! " + err);
  }
}

export class Game {
  private static nextGameId: number = 0;

  private _id: number;
  private _pipe: Pipe;
  private _em: EntityManager;
  private _loopTimeout: NodeJS.Timeout;
  private _actionQueue: PlayerAction[] = [];
  private _gameLogic: GameLogic;

  constructor(pipe: Pipe) {
    this._id = Game.nextGameId++;
    this._pipe = pipe;
    this._em = new EntityManager();

    const spatialSystem = new SpatialSystem(this._em, WORLD_W, WORLD_H);
    const agentSystem = new AgentSystem();

    this._em.addSystem(ComponentType.SPATIAL, spatialSystem);
    this._em.addSystem(ComponentType.AGENT, agentSystem);

    this._gameLogic = new GameLogic(this._em);

    console.log(`Starting game ${this._id}`);

    this._populate();

    this._loopTimeout = setInterval(() => noThrow(this._tick.bind(this)),
                                    FRAME_DURATION_MS);
  }

  private _tick() {
    while (this._actionQueue.length > 0) {
      const action = <PlayerAction>this._actionQueue.shift();
      this._gameLogic.handlePlayerAction(action);
    }

    this._em.update();
    const dirties = this._em.getDirties();

    if (dirties.length > 0) {
      console.log("Sending state update");
      console.log(dirties);

      const response: RGameState = {
        type: GameResponseType.GAME_STATE,
        packets: dirties
      };

      this._pipe.send(response);
    }
  }

  private _populate() {
    const spatialSys = <SpatialSystem>this._em.getSystem(ComponentType.SPATIAL);

    const numRocks = 5;
    const numGems = 5;

    let coords: [number, number][] = [];
    for (let c = 0; c < WORLD_W; ++c) {
      for (let r = 0; r < WORLD_H; ++r) {
        coords.push([c * BLOCK_SZ, r * BLOCK_SZ]);
      }
    }

    coords = _.shuffle(coords);
  
    const response: RNewEntity = {
      type: GameResponseType.NEW_ENTITIES,
      newEntities: []
    };

    let idx = 0;
    const rockCoords = coords.slice(0, numRocks);
    idx += numRocks;
    const gemCoords = coords.slice(idx, idx + numGems);
    idx += numGems;
    const soilCoords = coords.slice(idx);

    rockCoords.forEach(([c, r]) => {
      const id = constructRock(this._em);
      response.newEntities.push({
        entityId: id,
        entityType: EntityType.ROCK
      });
      spatialSys.positionEntity(id, c, r);
    });

    gemCoords.forEach(([c, r]) => {
      const id = constructGem(this._em);
      response.newEntities.push({
        entityId: id,
        entityType: EntityType.GEM
      });
      spatialSys.positionEntity(id, c, r);
    });

    soilCoords.forEach(([c, r]) => {
      const id = constructSoil(this._em);
      response.newEntities.push({
        entityId: id,
        entityType: EntityType.SOIL
      });
      spatialSys.positionEntity(id, c, r);
    });
  
    this._pipe.send(response);
  }

  addPlayer(pinataId: string, pinataToken: string): EntityId {
    const id = constructPlayer(this._em, pinataId, pinataToken);
    const response: RNewEntity = {
      type: GameResponseType.NEW_ENTITIES,
      newEntities: [{
        entityId: id,
        entityType: EntityType.PLAYER
      }]
    };
    this._pipe.send(response);
    console.log(`Adding player ${id}`);
    return id;
  }

  removePlayer(id: EntityId) {
    console.log(`Removing player ${id}`);
    this._em.removeEntity(id);
  }

  get numPlayers() {
    return this._em.getSystem(ComponentType.AGENT).numComponents();
  }

  get id() {
    return this._id;
  }

  onPlayerAction(action: PlayerAction) {
    console.log(`Received ${action.type} action from player ` +
                `${action.playerId}`);

    this._actionQueue.push(action);
  }

  terminate() {
    console.log(`Terminating game ${this._id}`);
    clearInterval(this._loopTimeout);
  }
}