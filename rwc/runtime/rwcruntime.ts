export class RwcElement extends HTMLElement {

    private $updates: Record<string, Update[]>;
    protected $ifExpressions: [];

    constructor() {
        super();
        this.attachShadow({
            mode: 'open'
        });
        this.$updates = {};
        this.$ifExpressions = [];
    }

    public connectedCallback(): void {
        const connectedEvent = new CustomEvent("$connected", {
            bubbles: true,
            composed: true
        });
        this.dispatchEvent(connectedEvent);
    }

    public $getUpdates(proxyName: string): Update[] {
        if (!(proxyName in this.$updates)) {
            this.$updates[proxyName] = [];
        }
        return this.$updates[proxyName];
    }

    /**
     * TODO resolve any type
     * 
     * @param node 
     */
    public $nullifyNode(node: any) {
        for (let child of node.childNodes) {
            this.$nullifyNode(child);
        }
        if (node.$forremove === false) {
            node.$forremove = true;
        }
        node.$remove = true;
        if (node.$el) {
            this.$nullifyNode(node.$el);
        }
    }

    /**
     * TODO: resolve any type
     * 
     * @param name 
     * @param val 
     */
    public $setProp(name: string, val: any): void {
        const self = <any> this;
        if (self[name]?.$reactive === true) {
            if (val.$reactive === true) {
                self[name] = val;
                if (!val.$props.has(name)) {
                    val.$rwcs.push(() => this.$doUpdate(name));
                    val.$props.add(name);
                }
            } else {
                self[name] = this.reactive(val, name);
            }
        } else {
            self[name] = val;
            this.$doUpdate(name);
        }
        // setTimeout(() => this.$doUpdate(name));
        // requestAnimationFrame(() => {
        //     this.$doUpdate(name);
        // });
        // this.$doUpdate(name);
    }


    /**
     * Creates a reactive Proxy for a primitive, array or object.
     * 
     * @param val value to be wrapped in a proxy
     * @param name proxy name
     * @returns reactive Proxy
     */
    public reactive(val: any, name: string) {
        if (Array.isArray(val)) {
            return this.reactiveArray(val, name);
        } else if (typeof val === 'object' && val) {
            return this.reactiveObject(val, name);
        } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null || val === undefined) {
            return this.reactivePrimitive(val, name);
        }
    }

    private reactiveArray(val: any[], name: string): any[] {
        // TODO: check how to use path (e.g. array index chain, object property chain) to update only the changed array/object if it is nested in another array/object
        if (!name) {
            console.error('Please provide a name to create a reactive array.');
            return val;
        }
        let newVal: any[] = [];
        for (let v of val) {
            if (Array.isArray(v)) {
                newVal.push(this.reactiveArray(v, name));
            } else if (typeof v === 'object') {
                newVal.push(this.reactiveObject(v, name));
            } else {
                newVal.push(v);
            }
        }
        val = newVal;
        this.defineRwcProperties(val, name);
        let p = new Proxy(val, {
            set: (target, property, value, receiver) => {
                // TODO: check this if condition
                if (Array.isArray(value) && property !== '$rwcs' && property !== '$props') {
                    value = this.reactiveArray(value, name);
                } else if (typeof value === 'object') {
                    value = this.reactiveObject(value, name);
                }
                (<any> target)[property] = value;
                this.runRwcs(p);
                return true;
            }
        });
        this.runRwcs(p);
        return p;
    }

    private reactiveObject(val: any, name: string) {
        if (!name) {
            console.error('Please provide a name to create a reactive object.');
            return val;
        }
        for (let key in val) {
            let v = val[key];
            if (Array.isArray(v)) {
                val[key] = this.reactiveArray(v, name);
            } else if (typeof v === 'object') {
                val[key] = this.reactiveObject(v, name);
            }
        }
        this.defineRwcProperties(val, name);
        let p = new Proxy(val, {
            set: (target, property, value) => {
                if (Array.isArray(value) && property !== '$rwcs' && property !== '$props') {
                    value = this.reactiveArray(value, name);
                } else if (typeof value === 'object') {
                    value = this.reactiveObject(value, name);
                }
                target[property] = value;
                this.runRwcs(p);
                return true;
                // return Reflect.set(target, property, value); ?
            },
            defineProperty: (target, key, descriptor) => {
                if (Array.isArray(descriptor.value)) {
                    descriptor.value = this.reactiveArray(descriptor.value, name);
                } else if (typeof descriptor.value === 'object') {
                    descriptor.value = this.reactiveObject(descriptor.value, name);
                }
                Reflect.defineProperty(target, key, descriptor);
                this.runRwcs(p);
                return true;
            }
        });
        this.runRwcs(p);
        return p;
    }

    private reactivePrimitive(val: Primitive, name: string): any {
        if (!name) {
            console.error('Please provide a name to create a reactive primitive.');
            return val;
        }
        let obj = {
            value: val,
            prev: val
        };
        this.defineRwcProperties(obj, name);
        let p = new Proxy(obj, {
            set: (target, property, value, receiver) => {
                // TODO: test reassigning to a reactive primitive.
                // Is this enough to use assignment with primitives instead of Proxies?
                // If using injected doUpdate with primitives we should first check if the value is still actually a primitive.
                if (Array.isArray(value) && property !== '$rwcs' && property !== '$props') {
                    value = this.reactiveArray(value, name);
                } else if (typeof value === 'object') {
                    value = this.reactiveObject(value, name);
                }
                const res: any = Reflect.set(target, property, value, receiver);
                if (target.value !== target.prev) {
                    target.prev = target.value;
                    this.runRwcs(p);
                }
                return res;
            },
            // get: (target, property, value) => {
            //     return Reflect.set(target.value, property, value);
            // }
        });
        this.runRwcs(p);
        return p;
    }

    /**
     * Defines $reactive, $rwcs and $props properties on an object.
     *  
     * @param obj object to add new properties to
     * @param proxyName proxy name
     */
    private defineRwcProperties(obj: any, proxyName: string): void {
        Object.defineProperty(obj, '$reactive', {
            value: true,
            enumerable: false,
            writable: false
        });
        Object.defineProperty(obj, '$rwcs', {
            value: [() => this.$doUpdate(proxyName)],
            enumerable: false,
            writable: true
        });
        Object.defineProperty(obj, '$props', {
            value: new Set(),
            enumerable: false,
            writable: true
        });
    }

    private runRwcs(proxy: any) {
        requestAnimationFrame(() => {
            for (let rwc of proxy.$rwcs) {
                rwc();
            }
        });
    }

    public $doUpdate(proxyName: string): void {
        if (!(proxyName in this.$updates)) {
            this.$updates[proxyName] = [];
        }
        // TODO check if filter is still needed before update
        this.$updates[proxyName] = this.$updates[proxyName].
            filter(update => update.isValid());
        for (const update of this.$updates[proxyName]) {
            update.update();
        }
    }

    public $filterUpdates(): void {
        for (let proxyName in this.$updates) {
            this.$updates[proxyName] = this.$updates[proxyName].
                filter(update => update.isValid());
        }
    }

    public $onUpdate(proxyName: string, fun: Function): void {
        this.$getUpdates(proxyName).push({
            isValid: () => true,
            update: () => fun()
        })
    }
}

interface Update {

    /**
     * Returns true if the update is valid and should be applied when required or false
     * if the update should be removed from component's list of updates.
     * 
     * @returns true if the update is still valid else false
     */
    isValid(): boolean;

    /**
     * Code that updates a component.
     */
    update(): void;
}

type Primitive = string | number | boolean | null | undefined;
