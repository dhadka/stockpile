export class TimeSpan {
    private milliseconds: number

    constructor(milliseconds: number) {
        this.milliseconds = milliseconds
    }

    static specToMultiplier(spec: string): number {
        switch (spec) {
            case 'ms':
                return 1
            case 's':
                return 1000
            case 'm':
                return 60 * 1000
            case 'h':
                return 60 * 60 * 1000
            case 'd':
                return 24 * 60 * 60 * 1000
            case 'w':
                return 7 * 24 * 60 * 60 * 1000
            case 'y':
                return 365 * 24 * 60 * 60 * 1000
            default:
                throw Error(`Unrecognized timespan spec '${spec}'`)
        }
    }

    static fromDates(d1: Date, d2: Date): TimeSpan {
        return new TimeSpan(d1.getTime() - d2.getTime())
    }

    static fromString(span: string): TimeSpan {
        const match = span.match(/^\s*([0-9]+)\s*([a-zA-Z]+)\s*$/)

        if (match) {
            const value = parseInt(match[1])
            const multiplier = this.specToMultiplier(match[2])
            return new TimeSpan(value * multiplier)
        } else {
            throw Error(`Unrecognized timespan format '${span}'`)
        }
    }

    isGreaterThan(span: TimeSpan): boolean {
        return this.milliseconds > span.milliseconds
    }

    isLessThan(span: TimeSpan): boolean {
        return this.milliseconds < span.milliseconds
    }

    toString(): string {
        let value = this.milliseconds

        const days = Math.floor(value / (24 * 60 * 60 * 1000))
        value -= days * (24 * 60 * 60 * 1000)
        const hours = Math.floor(value / (60 * 60 * 1000))
        value -= hours * (60 * 60 * 1000)
        const minutes = Math.floor(value / (60 * 1000))
        value -= minutes * (60 * 1000)
        const seconds = Math.floor(value / 1000)
        value -= seconds * 1000

        let result = ""
        
        //if (days > 0) {
            result = days.toString() + "."
        //}

        if (hours < 10) {
            result += "0"
        }

        result += hours.toString()
        result += ":"

        if (minutes < 10) {
            result += "0"
        }

        result += minutes.toString()
        result += ":"

        if (seconds < 10) {
            result += "0"
        }

        result += seconds.toString()
        return result
    }
}