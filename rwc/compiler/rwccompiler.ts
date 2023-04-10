import * as acorn from 'acorn';
import { generate } from 'astring';
import * as htmlparser2 from 'htmlparser2';
import * as walk from 'acorn-walk';
import {
    getChildren, textContent, getName,
    hasAttrib, getAttributeValue, getParent
} from 'domutils';
import { Element, ChildNode, AnyNode, Text } from '../../node_modules/htmlparser2/node_modules/domhandler';
import * as estree from 'estree';
import { 
    AssignmentExpression, BlockStatement, Expression, 
    ForStatement, Literal, MemberExpression, 
    MethodDefinition,Program, SpreadElement, Statement 
} from 'estree';

export class RwcCompiler {
    
    private _componentSrc: string | null = null;
    private _viewRoot: ChildNode | null = null;
    private _styleSrc: string | null = null;
    private _ast: acorn.Node | null = null;
    private _componentName: string = '';
    private _proxies: Set<string> = new Set();
    private _constructorNode: acorn.Node | null = null;

    private getComponentName(): string {
        return this._componentName;
    }
    private setComponentName(val: string | undefined) {
        this._componentName = val || '';
    }

    private getComponentSrc(): string | null {
        return this._componentSrc;
    }

    private setComponentSrc(val: string) {
        this._componentSrc = val;
    }

    private getStyleSrc(): string | null {
        return this._styleSrc;
    }

    private setStyleSrc(val: string) {
        this._styleSrc = val;
    }

    private getViewRoot(): ChildNode | null {
        return this._viewRoot;
    }

    private setViewRoot(val: ChildNode) {
        this._viewRoot = val;
    }

    private getProxies(): Set<string> {
        return this._proxies;
    }

    private getConstructorNode(): acorn.Node | null {
        if (this._constructorNode === null) {
            this._constructorNode = this.findConstructorNode();
        }
        return this._constructorNode;
    }

    /**
     * Adds a new reactive proxy name to the set of existing proxy names
     * 
     * @param name reactive proxy name to be added to existing proxies
     */
    private addProxyName(name: string): void {
        this.getProxies().add(name);
    }

    /**
     * Returns web component abstract syntax tree or null. Initializes the ast if needed. 
     * 
     * @returns web component abstract syntax tree or null
     */
    private getAst(): acorn.Node | null {
        if (this._ast === null) {
            this.initAst();
        }
        return this._ast;
    }

    /**
     * Parses rwc <component> source and sets ast value.
     */
    private initAst(): void {
        const componentSrc: string | null = this.getComponentSrc();
        if (this._ast === null && componentSrc !== null) {
            this._ast = toAst(componentSrc);
        }
    }

    /**
     * Generates reactive Javascript web component source from rwc syntax.
     * 
     * @param rwcSrc rwc file source string
     * @returns generated web component from rwc source or null if not successful
     */
    public generateWebComponent(rwcSrc: string): string | null {
        const root = htmlparser2.parseDocument(rwcSrc);
        
        for (let childNode of getChildren(root)) {
            const element: Element = <Element> childNode;
            switch (getName(element)) {
                case 'component':
                    if (hasAttrib(element, 'name')) {
                        this.setComponentName(getAttributeValue(element, 'name'));
                        this.setComponentSrc(textContent(childNode));
                    } else {
                        this.printError('name attribute missing from <component>');
                        return null;
                    }
                    break;
                case 'style':
                    this.setStyleSrc(textContent(childNode));
                    break;
                case 'view':
                    this.setViewRoot(childNode);
                    break;
            }
        }

        if (this.getComponentSrc === null) {
            this.printError('<component> missing.');
            return null;
        }
        
        this.parseComponentSrc();
        this.appendStyle();
        this.appendView();
         
        return this.generateComponent();
    }

    /**
     * TODO: https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API
     *       Re-printing Sections of a TypeScript File
     *       for reading a ts file -> use to create standalone components? 
     * @returns 
     */

    /* TODO  docstring
     * not sure what this does? check if needed. is proxies always empty??

    answer: this will do something if a reactive variable is dependent on another reactive variable.
     */
    private parseComponentSrc(): void {
        this.setComponentSrc(`class ${this.getComponentName()} extends rwc.RwcElement {
            ${this.getComponentSrc()}
        }`);

        const ast = this.getAst();
        
        if (ast === null) {
            return;
        }
        
        // find reactive proxies
        walk.full(ast, node => {
            const estreeNode = <estree.Node> node;
            const data = this.getReactiveAssignmentData(estreeNode);
            if (data === null) {
                return;
            }

            this.addProxyName(data.name);

            let nameNode: Literal = {
                type: 'Literal',
                value: data.name,
                raw: `'${data.name}'`
            }

            data.args.push(nameNode);
            
            let proxies = this.getReferencedProxyNames(<acorn.Node> data.args[0]);
            for (let proxy of proxies) {
                this.appendCodeToConstructor(`
                    this.$getUpdates('${proxy}').push({
                        isValid: () => true,
                        update: () => {
                            this.${data.name}.value = ${generate(data.args[0])} 
                        }
                    });
                `);
            }
        });
    }

    /**
     * Appends new code to constructor node body.
     * 
     * @param code source string to be converted to ast nodes and appended to constructor body
     */
    private appendCodeToConstructor(code: string): void {
        const ctor = this.getConstructorNode();
        if (ctor === null) {
            return;
        }
        this.appendCodeToMethod(<estree.Node> ctor, code);
    }

    private appendCodeToMethod(node: estree.Node | ForNode | BlockStatement| null, code: string | BlockStatement): Statement[] | null {
        let estreeNode: BlockStatement | null = null;
        if (node instanceof ForNode) {
            estreeNode = node.getForBody();
        } else if ((<estree.Node> node).type === 'BlockStatement') {
            estreeNode = <BlockStatement> node;
        } else {
            let currNode = <estree.Node> node;
            if (currNode.type === 'MethodDefinition') {
                estreeNode = currNode.value.body;
            } else {
                return null;
            }
        }
        if (estreeNode === null) {
            return null;
        }
        let bodyStatements: Statement[];
        if (typeof code === 'string') {
            const program = <Program> <estree.Node> toAst(code);
            bodyStatements = program.body.map(s => <Statement> s);
        } else {
            bodyStatements = [<Statement> code];
        }
        estreeNode.body.push(...bodyStatements);
        return bodyStatements;
    }

    /**
     * Returns a set of proxy name strings found in the ast.
     * 
     * @param startNode ast node from which to start searching for proxy names
     * @param referencedProxies set of found proxy names
     * @returns set of found proxy names
     */
    public getReferencedProxyNames(startNode: acorn.Node, referencedProxies = new Set<string>): Set<string> {
        walk.full(startNode, node => {
            const estreeNode = <estree.Node> node;
            if (estreeNode.type === 'MemberExpression') {
                const memberExpr = <MemberExpression> estreeNode;
                if (memberExpr.object.type === 'ThisExpression' && 
                    (memberExpr.property.type === 'PrivateIdentifier' || memberExpr.property.type === 'Identifier')) {
                    const proxyName = memberExpr.property.name;
                    if (this.getProxies().has(proxyName)) {
                        referencedProxies.add(proxyName);
                    }
                }
            } else if (estreeNode.type === 'CallExpression') {
                if (estreeNode.callee.type === 'MemberExpression') {
                    if (estreeNode.callee.property.type === 'PrivateIdentifier' || estreeNode.callee.property.type === 'Identifier') {
                        let methodNode = this.findMethodAstNode(estreeNode.callee.property.name);
                        if (methodNode !== null) {
                            this.getReferencedProxyNames(methodNode, referencedProxies);
                        }
                    }
                }
            }
        });
        return referencedProxies;
    }

    /**
     * Returns ast node for method definition with matching name if it extsts.
     * 
     * @param name method name to find
     * @param startNode ast node from where to start searching
     * @returns method definition ast node or null if not found
     */
    private findMethodAstNode(name: string, startNode: acorn.Node | null = null): acorn.Node | null {
        let res: acorn.Node | null = null;
        startNode = startNode === null ? this.getAst() : startNode;
        if (startNode === null) {
            return res;
        }
        walk.simple(startNode, {
            MethodDefinition(node) {
                const estreeNode = <estree.Node> node;
                const methodDefinition = <MethodDefinition> estreeNode;
                if (methodDefinition.kind == 'method' && 
                    (methodDefinition.key.type === 'PrivateIdentifier' || methodDefinition.key.type === 'Identifier') && 
                    methodDefinition.key.name === name) {
                        res = node;
                }
            }
        });
        return res;
    }

    /**
     * Returns a constructor node in the ast if one exists.
     * 
     * @param startNode ast node to start searching from
     * @returns constructor ast node or null if no constructor found
     */
    private findConstructorNode(startNode: acorn.Node | null = null): acorn.Node | null{
        startNode = startNode === null ? this.getAst() : startNode;
        if (startNode === null) {
            return null;
        } 
        let constructor: acorn.Node | null = null;
        walk.simple(startNode, {
            MethodDefinition(node) {
                const estreeNode = <estree.Node> node;
                const methodDefinition = <MethodDefinition> estreeNode; 
                if (methodDefinition.kind === 'constructor') {
                    constructor = node;
                }
            }
        });
        return constructor;
    }

    /**
     * Returns reactive variable name and CallExpression arguments list if node is a reactive assignment and null otherwise.
     * 
     * @param node ast node to get reactive assignment data from
     * @returns object with reactive variable name and CallExpression args list or null if node is not a reactive assignment
     */
    private getReactiveAssignmentData(node: estree.Node): null| { name: string, args: Array<Expression | SpreadElement> } {
        if (node.type !== 'AssignmentExpression') {
            return null;
        }

        const assignmentExpr = <AssignmentExpression> node;
        
        if (assignmentExpr.left.type !== 'MemberExpression') {
            return null;
        }
        if (assignmentExpr.left.object.type !== 'ThisExpression') {
            return null;
        }
        if (assignmentExpr.left.property.type !== 'PrivateIdentifier' && 
            assignmentExpr.left.property.type !== 'Identifier') {
                return null;
        }
        if (assignmentExpr.right.type !== 'CallExpression') {
            return null;
        }
        if (assignmentExpr.right.callee.type !== 'MemberExpression') {
            return null;
        }
        if (assignmentExpr.right.callee.property.type !== 'PrivateIdentifier' && 
            assignmentExpr.right.callee.property.type !== 'Identifier') {
                return null;
        }
        if (assignmentExpr.right.callee.property.name !== 'reactive') {
            return null;
        }
        
        return {
            name: assignmentExpr.left.property.name,
            args: assignmentExpr.right.arguments
        };
    }

    /**
     * Appends style code to constructor ast node if any styles are present.
     */
    private appendStyle(): void {
        const style = this.getStyleSrc();
        if (style === null) {
            return;
        }
        const str = `const style = document.createElement('style');
            style.textContent = \`${style.trim()}\`
            this.shadowRoot.appendChild(style);
        `;
        this.appendCodeToConstructor(str);
    }

    private appendView(): void {
        const rootNode = this.getViewRoot();
        if (rootNode === null) {
            return;
        }
        
        const ctor = this.getConstructorNode();
        if (ctor === null) {
            return;
        }
        const queue: (ChildNode | 'CLOSE_FOR')[] = [...getChildren(rootNode)];
        let currParentNode: AnyNode | null = rootNode;

        this.appendCodeToConstructor( `
            let el = null;
            let currParent = this.shadowRoot;
        `);

        const forStack = [];
        let currForNode: ForNode | null = null;
        let prevWasCloseFor = false;

        while (queue.length > 0) {
            let node = queue.shift();
            if (node === undefined) {
                break;
            }
            
            if (node === 'CLOSE_FOR') {
                if (currForNode === null) {
                    continue;
                }
                if (currForNode.hasChildren()) {
                    this.appendCodeToMethod(currForNode, `
                        currParent = currParent.parentNode || currParent.$template.parentNode;
                    `);
                }
                if (currForNode.getProxies().size > 0) {
                    const forStatementNode = currForNode.getForStatementNode();
                    if (forStatementNode === null) {
                        continue;
                    }
                    let stringifiedLoop = generate(forStatementNode);
                    for (let p of currForNode.getProxies()) {
                        this.appendCodeToMethod(currForNode.getBlockBody(), `
                            this.$getUpdates('${p}').push({
                                isValid: () => {
                                    if (!template) return false;
                                    if (template.$forremove === true) {
                                        return false;
                                    }
                                    let remove = false;
                                    if (nodes.length > 0) {
                                        for (let e of nodes) {
                                            if (e.$forremove === true) {
                                                return false;
                                            } else if (e.$el?.$forremove === true) {
                                                return false;
                                            }
                                        }
                                    }
                                    return true;
                                },
                                update: () => {
                                    if (!template) return;
                                    let remove = false;
                                    if (nodes.length > 0) {
                                        if (nodes[0].parentNode === null) {
                                            nodes[0].$template.replaceWith(template);
                                        } else {
                                            nodes[0].replaceWith(template);
                                        }
                                        for (let e of nodes) {
                                            if (e.$forremove === true) {
                                                remove = true;
                                            } else if (e.$el?.$forremove === true) {
                                                remove = true;
                                            } else {
                                                this.$nullifyNode(e);
                                            }
                                            e.remove();
                                            if (e.$el) {
                                                e.$el.remove();
                                            }
                                        }
                                        nodes = [];
                                    }
                                    currParent = template;
                                    ${stringifiedLoop}
                                    if (nodes.length > 0) {
                                        template.replaceWith(...template.childNodes);
                                        template.replaceChildren();
                                    }
                                    if (remove) {
                                        template = null;
                                    }
                                    this.$filterUpdates();
                                }
                            });
                        `);
                    }
                    if (forStack.length === 1) {
                        currForNode.getBlockBody()?.body.splice(3, 1);
                    }

                }
                prevWasCloseFor = currForNode.hasChildren();
                forStack.pop();
                if (forStack.length > 0) {
                    currForNode = forStack[forStack.length - 1];
                } else {
                    currForNode = null;
                }
                continue;
            }

            if (getParent(node) !== currParentNode) {
                currParentNode = getParent(node);
                if (!prevWasCloseFor) {
                    this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                        currParent = currParent.parentNode || currParent.$template.parentNode;
                    `);
                } else {
                    prevWasCloseFor = false;
                }
            }

            if (node.nodeType === 1) {
                // ELEMENT node
                for (let attr of (<Element> node).attributes) {
                    if (attr.name === SYNTAX.forAttribute) {
                        const forNode = new ForNode(attr.value);
                        this.appendCodeToMethod(currForNode || <estree.Node> ctor, forNode.getBlockBody() || '');
                        forStack.push(forNode);
                        currForNode = forNode;
                        currForNode.setProxies(this.getReferencedProxyNames(toAst(`
                            for (${forNode.getForExpression()}) {}
                        `)));
                    }
                }

                this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                    el = document.createElement('${getName(<Element> node)}');
                    ${currForNode ? 'el.$forremove = false;' : ''}
                    ${currForNode ? 'nodes.push(el);' : ''}
                    ${currForNode ? 'el.$fortemplate = template;' : ''}
                    currParent.appendChild(el);
                `);

                for (let attr of (<Element> node).attributes) {
                    if (attr.name.match(/^\(.*\)$/)) {
                        // event listeners
                        const eventName = attr.name.slice(1, -1);
                        this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                            el.addEventListener('${eventName}', ${attr.value});
                        `);
                    } else if (attr.name === SYNTAX.ifAttribute) {
                        const ifExpression = attr.value;
                        this.appendCodeToMethod(currForNode || <estree.Node> ctor, this.createIfBody(ifExpression, currForNode));
                        const proxies = this.getReferencedProxyNames(toAst(ifExpression));
                        if (proxies.size > 0) {
                            for (let proxy of proxies) {
                                this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                                    this.$getUpdates('${proxy}')
                                        .push(this.$ifExpressions[this.$ifExpressions.length - 1]);
                                `);
                            }
                        }
                        this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                            this.$ifExpressions = [];
                        `);
                    } else if (attr.name === SYNTAX.forAttribute) {
                        // do nothing
                    } else if (attr.name.startsWith(SYNTAX.prop)) {
                        // prop
                        const attrName = attr.name.slice(1);
                        this.appendCodeToMethod(currForNode || <estree.Node> ctor, `{
                            let element = el;
                            const interval = setInterval(() => {
                                if (element.$setProp) {
                                    clearInterval(interval);
                                    element.$setProp('${attrName}', ${attr.value});
                                }
                            }, 16.6);
                        }`);
                    } else {
                        // other attributes
                        this.handleAttribute(attr, currForNode);
                    }
                }
            } else if (node.nodeType === 3) {
                // text node
                this.handleTextNode(node, currForNode);
            }

            const children: ChildNode[] = getChildren(node);

            // push a value to notify to close a for node
            if (this.nodeHasForAttribute(node)) {
                queue.unshift('CLOSE_FOR');
                if (children.length > 0 && currForNode) {
                    currForNode.setHasChildren(true);
                }
            }

            // add children to the start of the queue - go depth first
            if (children.length > 0) {
                this.appendCodeToMethod(currForNode || <estree.Node> ctor, `
                    currParent = el;
                `);
                currParentNode = node;
                queue.unshift(...children);
            }
        }
    }

    private handleAttribute(attribute: Attribute, forNode: ForNode | null): void {
        const res = this.filterTextContent(attribute.value);
        this.handleAttributeOrTextNode(
            forNode, 
            `el.setAttribute('${attribute.name}', ${res.filtered});`,
            `node.setAttribute('${attribute.name}', ${res.filtered});`,
            res.expressions
        );
    }

    private handleTextNode(node: Text, forNode: ForNode | null): void {
        const res = this.filterTextContent(textContent(node));
        this.handleAttributeOrTextNode(
            forNode,
            `currParent.appendChild(document.createTextNode(${res.filtered}));`,
            `node.textContent = ${res.filtered};`,
            res.expressions
        );
    }

    private handleAttributeOrTextNode(forNode: ForNode | null, appendStr: string, updateStr: string, expressions: string[]): void {
        this.appendCodeToMethod(forNode || <estree.Node> this.getConstructorNode(), `
            ${appendStr}
            ${forNode ? 'currParent.lastChild.$forremove = false;' : ''}
        `);
        for (let expression of expressions) {
            for (let proxy of this.getReferencedProxyNames(toAst(expression))) {
                this.appendCodeToMethod(forNode || <estree.Node> this.getConstructorNode(), `{
                    let node = currParent.lastChild;
                    this.$getUpdates('${proxy}').push({
                        isValid: () => {
                            ${forNode ? 'if (node.$forremove === true) return false;' : ''}
                            if (node.$fortemplate?.$forremove === true) return false
                            if (node.$remove) return false;
                            return true;
                        },
                        update: () => {
                            ${updateStr}
                        }
                    });
                }`);
            }
        }
    }

    /**
     * Returns true if node has the *for attribute else false.
     * 
     * @param {*} node node to be checked for the *for attribute
     */
    private nodeHasForAttribute(node: ChildNode): boolean {
        if (node.nodeType !== 1) {
            return false;
        }
        for (let attr of (<Element> node).attributes) {
            if (attr.name === SYNTAX.forAttribute) {
                return true;
            }
        }
        return false;
    }

    /**
     * Creates a template literal and replaces {{.*}} with ${.*} such that the result may be used
     * in a Text node. Returns the filtered template literal and a list of expressions.
     * 
     * @param {*} text text to be filtered 
     */
    private filterTextContent(text: string): { filtered: string, expressions: string[] } {
        let depth = 0;
        let filtered = '';
        let expressions = [];
        let expression = '';
        let i = 0;
        for (; i < text.length - 1; i++) {
            // stop one before last character
            const curr = text[i];
            const next = text[i + 1];
            if (curr + next === '{{') {
                depth++;
                if (depth === 1) {
                    filtered += '${';
                    i++;
                    continue;
                }
            }
            if (curr + next === '}}') {
                depth--;
                if (depth === 0) {
                    filtered += '}';
                    expressions.push(expression);
                    expression = '';
                    i++;
                    continue;
                }
            }
            if (depth > 0) {
                expression += curr;
            }
            filtered += curr;
        }
        if (i == text.length - 1) {
            // add last character if not an expression
            filtered += text[i];
        }
        return {
            filtered: '`' + filtered + '`',
            expressions: expressions
        };
    }

    private createIfBody(ifExpression: string, currForNode: ForNode | null): string {
        return  `{
            let element = el;
            let iftemplate = document.createElement('template');
            ${currForNode ? 'iftemplate.$forremove = false;' : ''}
            iftemplate.$el = element;
            element.$template = iftemplate;
            this.$ifExpressions.push({
                isValid: () => {
                    if (element.$forremove === true || element.$template.$forremove === true || element.$remove || element.$template.$remove || element.$template === null) {
                        return false;
                    }
                    return true;
                },
                update: () => {
                    if (${ifExpression}) {
                        if (!element.parentNode) {
                            element.$template.replaceWith(element);
                        }
                    } else {
                        if (!element.$template.parentNode) {
                            element.replaceWith(element.$template);
                        }
                    }
                }
            });
            this.$ifExpressions[this.$ifExpressions.length - 1].update();
        }`
    }

    /**
     * Returns generated reactive Javascript web component source string or null.
     * 
     * @returns generated Javascript web component source string or null if not successful
     */
    private generateComponent(): string | null {
        let tagName = this.getComponentName().split(/(?=[A-Z])/)
            .map(n => n.toLocaleLowerCase())
            .join('-');
        const ast = this.getAst();
        if (ast === null) {
            return null;              
        }
        const program = <Program> <estree.Node> ast;
        const defineProgram = <Program> <estree.Node> toAst(`
            customElements.define('${tagName}', ${this.getComponentName()});
        `);
        program.body.push(...defineProgram.body);
        const component = generate(program);
        return component;
    }

    // TODO throw errors instead of returning after printing
    private printError(msg: string): void {
        console.error(`Error parsing rwc source: ${msg}.`);
    }
}

class IfNode {
    // TODO
}

function toAst(code: string): acorn.Node {
    return acorn.parse(code, {
        ecmaVersion: 2020
    });
}

class ForNode {

    private _proxies: Set<string> = new Set<string>();
    private _blockBody: BlockStatement | null = null;
    private _forBody: BlockStatement | null = null;
    private _forExpression: string = '';
    private _hasChildren: boolean = false;
    private _forStatementNode: ForStatement | null = null;

    constructor(forExpression: string) {
        this._forExpression = forExpression;
        const program = <Program> <estree.Node> toAst(`{
            let nodes = [];
            let template = document.createElement('template');
            currParent.appendChild(template);
            for (${forExpression}) {}
            if (nodes.length > 0) {
                template.remove();
            }
            template.$forremove = false;
        }`);
        const bodyStatements = program.body.map(s => <Statement> s);
        this._blockBody = <BlockStatement> bodyStatements[0];
        this._forStatementNode = <ForStatement> this._blockBody.body[3];
        this._forBody = <BlockStatement> this._forStatementNode.body;
    }

    public getForStatementNode(): ForStatement | null {
        return this._forStatementNode;
    }

    public setHasChildren(val: boolean) {
        this._hasChildren = val;
    }

    public hasChildren(): boolean {
        return this._hasChildren;
    }

    public getForExpression(): string {
        return this._forExpression;
    }

    public setProxies(proxies: Set<string>): void {
        this._proxies = proxies;
    }

    public getForBody(): BlockStatement | null {
        return this._forBody;
    }

    public getBlockBody(): BlockStatement | null {
        return this._blockBody;
    }

    public getProxies(): Set<string> {
        return this._proxies;
    }
}

interface Attribute {
    name: string;
    value: string;
    namespace?: string;
    prefix?: string;
}

const SYNTAX = {
    'forAttribute': '*for',
    'ifAttribute': '*if',
    'prop': '@'
}
