declare global {
    interface String {
        /**
         * Case insensitive version of string.startsWith() function
         */
        iStartsWith(searchString: string): boolean
        /**
         * Case insensitive string comparison
         */
        iEquals(str: string): boolean
        /**
         * Case insensitive version of string.includes() function
         */
        iIncludes(searchString: string): boolean
    }
    interface Array<T> {
        /**
         * Returns the first element of the array or undefined if the array is empty
         */
        first(): T

       /**
         * Returns the value of the first element in the array where predicate is true
         * and casts it as the specified type, and undefined otherwise.
         * @param predicate find calls predicate once for each element of the array, in ascending
         * order, until it finds one where predicate returns true. If such an element is found, find
         * immediately returns that element value. Otherwise, find returns undefined.
         * @param thisArg If provided, it will be used as the this value for each invocation of
         * predicate. If it is not provided, undefined is used instead.
         */
        findAs<S extends T>(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): S

        /**
         * Returns the last element of the array or undefined if the array is empty
         */
        last(): T

        /**
         * Casts the elements of the array to the specified type
         */
        asType<S>(): Array<S>

        /**
         * Flattens the arrays resulting from calling the defined callback function on each element of the array into one array
         * @param callbackfn A function that accepts up to three arguments. The map method calls the callbackfn function one time for each element in the array.
         * @param thisArg An object to which the this keyword can refer in the callbackfn function. If thisArg is omitted, undefined is used as the this value.
         */
        mapAndFlatten<U>(callbackfn: (value: T, index: number, array: T[]) => U[], thisArg?: any): U[]

        /**
         * Creates a readonly array of numbers starting at the specified number
         * @param size The size of the resulting array
         * @param startAt The number at which to start
         */
        range(size: number, startAt: number): ReadonlyArray<number>
    }
}

String.prototype.iStartsWith = function(searchString: string) {
    return this.toLowerCase().startsWith(searchString.toLowerCase())
}
String.prototype.iEquals = function(str: string) {
    return this.toLowerCase() === str.toLowerCase()
}
String.prototype.iIncludes = function(searchString: string) {
    return this.toLowerCase().includes(searchString.toLowerCase())
}

Array.prototype.first = function () {
    if (this.length > 0) {
        return this[0]
    }
    return undefined
}
Array.prototype.findAs = function<S>(predicate: (value: any, index: number, obj: any[]) => unknown, thisArg?: any) : S {
    return this.find(predicate) as S
}
Array.prototype.last = function() {
    if (this.length > 0) {
        return this[this.length - 1]
    }
    return undefined
}
Array.prototype.asType = function<S>() {
    return this.map(e => e as S)
}

Array.prototype.mapAndFlatten = function<U>(callbackfn: (value: any, index: number, array: any[]) => U[], thisArg?: any): U[] {
    return this.map(callbackfn).reduce((final, current) => {
        current?.forEach(x => final?.push(x))
        return final
    }, [])
}

Array.prototype.range = function range(size: number, startAt: number = 0): ReadonlyArray<number> {
    return [...Array(size).keys()].map(i => i + startAt);
}

export {}