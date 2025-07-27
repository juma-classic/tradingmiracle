import { makeAutoObservable } from "mobx";

class BotStore {
    currentBot = null;
    constructor() {
        makeAutoObservable(this);
    }
    setCurrentBot(bot: any) {
        this.currentBot = bot;
    }
}

export const botStore = new BotStore();
